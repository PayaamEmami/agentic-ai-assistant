import type { ChatProvider } from './model-provider.js';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ToolCall,
  ToolDefinition,
} from './types.js';

export const MAX_MODEL_CALLS = 3;

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface InlineToolResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  output: string;
}

export interface ModelTurnResult {
  response: string | null;
  /** Tool calls the caller must stage. Inline tools are omitted. */
  toolCalls: ParsedToolCall[];
  inlineResults: InlineToolResult[];
  /** True when this turn stopped so non-inline tools can run on the worker. */
  stagedExternalTools: boolean;
  usage?: CompletionResponse['usage'];
}

export interface RunModelTurnInput {
  provider: ChatProvider;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  inlineToolName: string;
  model?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onWebSearch?: () => void;
  runInlineTool: (call: ParsedToolCall) => Promise<string>;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted');
  }
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  if (!argumentsJson.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { rawArguments: argumentsJson };
  }
}

function parseToolCall(toolCall: ToolCall): ParsedToolCall {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: parseToolArguments(toolCall.arguments),
  };
}

function mergeUsage(
  left?: CompletionResponse['usage'],
  right?: CompletionResponse['usage'],
): CompletionResponse['usage'] | undefined {
  if (!left && !right) {
    return undefined;
  }
  return {
    promptTokens: (left?.promptTokens ?? 0) + (right?.promptTokens ?? 0),
    completionTokens: (left?.completionTokens ?? 0) + (right?.completionTokens ?? 0),
    totalTokens: (left?.totalTokens ?? 0) + (right?.totalTokens ?? 0),
  };
}

function publishVisibleAnswer(
  content: string | null,
  onTextDelta: ((delta: string) => void) | undefined,
): void {
  if (!onTextDelta || content == null || content.length === 0) {
    return;
  }
  onTextDelta(content);
}

function withInlineResults(
  messages: ChatMessage[],
  completion: CompletionResponse,
  roundResults: InlineToolResult[],
): ChatMessage[] {
  return [
    ...messages,
    {
      role: 'assistant',
      content: completion.content ?? '',
      toolCalls: completion.toolCalls,
    },
    ...roundResults.map((result) => ({
      role: 'tool' as const,
      content: result.output,
      toolCallId: result.callId,
      name: result.name,
    })),
  ];
}

async function completeOrStream(
  provider: ChatProvider,
  request: CompletionRequest,
  stream: boolean,
  onWebSearch?: () => void,
): Promise<CompletionResponse> {
  if (!stream) {
    const response = await provider.complete(request);
    if (response.webSearchUsed) {
      onWebSearch?.();
    }
    return response;
  }

  // Text from a round that also calls a tool is not the answer. The caller
  // publishes the kept reply after this returns, so tokens stay buffered here.
  let content = '';
  let finishReason: CompletionResponse['finishReason'] = 'stop';
  let usage: CompletionResponse['usage'] = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let webSearchUsed = false;
  const toolCallsById = new Map<string, ToolCall>();

  for await (const delta of provider.streamComplete(request)) {
    if (delta.type === 'text' && delta.text) {
      content += delta.text;
    } else if (delta.type === 'tool_call' && delta.toolCall) {
      toolCallsById.set(delta.toolCall.id, delta.toolCall);
    } else if (delta.type === 'web_search') {
      if (!webSearchUsed) {
        webSearchUsed = true;
        onWebSearch?.();
      }
    } else if (delta.type === 'done') {
      if (delta.usage) {
        usage = delta.usage;
      }
      if (delta.webSearchUsed) {
        if (!webSearchUsed) {
          onWebSearch?.();
        }
        webSearchUsed = true;
      }
      if (
        delta.finishReason === 'stop' ||
        delta.finishReason === 'tool_calls' ||
        delta.finishReason === 'length' ||
        delta.finishReason === 'content_filter'
      ) {
        finishReason = delta.finishReason;
      }
    }
  }

  return {
    messageId: '',
    content: content.length > 0 ? content : null,
    toolCalls: Array.from(toolCallsById.values()),
    finishReason,
    usage,
    webSearchUsed: webSearchUsed || undefined,
  };
}

/**
 * One model loop. Inline tool calls (workspace search) run here and the model
 * continues. Any other tool ends the loop so the caller can approve and enqueue it.
 */
export async function runModelTurn(input: RunModelTurnInput): Promise<ModelTurnResult> {
  let messages = input.messages;
  let usage: CompletionResponse['usage'] | undefined;
  const inlineResults: InlineToolResult[] = [];
  const stream = input.onTextDelta !== undefined || input.onWebSearch !== undefined;

  for (let attempt = 0; attempt < MAX_MODEL_CALLS; attempt++) {
    throwIfAborted(input.signal);
    const completion = await completeOrStream(
      input.provider,
      {
        messages,
        model: input.model,
        tools: input.tools,
        hostedWebSearch: true,
        signal: input.signal,
      },
      stream,
      input.onWebSearch,
    );
    usage = mergeUsage(usage, completion.usage);

    const calls = completion.toolCalls.map(parseToolCall);
    if (calls.length === 0) {
      publishVisibleAnswer(completion.content, input.onTextDelta);
      return {
        response: completion.content,
        toolCalls: [],
        inlineResults,
        stagedExternalTools: false,
        usage,
      };
    }

    const inline = calls.filter((call) => call.name === input.inlineToolName);
    const external = calls.filter((call) => call.name !== input.inlineToolName);
    const roundResults: InlineToolResult[] = [];

    for (const call of inline) {
      throwIfAborted(input.signal);
      const output = await input.runInlineTool(call);
      roundResults.push({
        callId: call.id,
        name: call.name,
        arguments: call.arguments,
        output,
      });
    }
    inlineResults.push(...roundResults);

    const canContinue =
      external.length === 0 && inline.length > 0 && attempt < MAX_MODEL_CALLS - 1;
    if (canContinue) {
      messages = withInlineResults(messages, completion, roundResults);
      continue;
    }

    if (external.length === 0 && roundResults.length > 0) {
      return finishAfterInlineCap(input, messages, completion, roundResults, inlineResults, usage);
    }

    publishVisibleAnswer(completion.content, input.onTextDelta);
    return {
      response: completion.content,
      toolCalls: external,
      inlineResults,
      stagedExternalTools: external.length > 0,
      usage,
    };
  }

  throw new Error('Model turn ended without a result');
}

/**
 * The search cap was spent on workspace search. One more call can answer from
 * those excerpts or stage a different tool. Further workspace searches are not run.
 */
async function finishAfterInlineCap(
  input: RunModelTurnInput,
  messages: ChatMessage[],
  completion: CompletionResponse,
  roundResults: InlineToolResult[],
  inlineResults: InlineToolResult[],
  usage: CompletionResponse['usage'] | undefined,
): Promise<ModelTurnResult> {
  throwIfAborted(input.signal);
  const stream = input.onTextDelta !== undefined || input.onWebSearch !== undefined;
  const finalCompletion = await completeOrStream(
    input.provider,
    {
      messages: withInlineResults(messages, completion, roundResults),
      model: input.model,
      tools: input.tools,
      hostedWebSearch: true,
      signal: input.signal,
    },
    stream,
    input.onWebSearch,
  );
  const mergedUsage = mergeUsage(usage, finalCompletion.usage);
  const finalExternal = finalCompletion.toolCalls
    .map(parseToolCall)
    .filter((call) => call.name !== input.inlineToolName);
  const response =
    finalCompletion.content?.trim()
      ? finalCompletion.content
      : finalExternal.length === 0
        ? inlineResults.map((result) => result.output).join('\n\n')
        : finalCompletion.content;
  publishVisibleAnswer(response, input.onTextDelta);
  return {
    response,
    toolCalls: finalExternal,
    inlineResults,
    stagedExternalTools: finalExternal.length > 0,
    usage: mergedUsage,
  };
}
