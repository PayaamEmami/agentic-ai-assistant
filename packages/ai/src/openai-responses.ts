import type {
  ChatContentPart,
  ChatMessage,
  CompletionResponse,
  StreamDelta,
  ToolCall,
  ToolDefinition,
} from './types.js';
import { extractTextFromParts, prepareTools, type PreparedTools } from './openai-mappers.js';

export interface WebCitation {
  url: string;
  title: string;
}

export interface ResponsesTurnState {
  text: string;
  /** How much of `text` has already been emitted as stream deltas. */
  emittedLength: number;
  settled: boolean;
  webSearchUsed: boolean;
  webSearchAnnounced: boolean;
  citations: WebCitation[];
  toolCalls: ToolCall[];
  usage?: CompletionResponse['usage'];
  failedMessage?: string;
}

interface ResponsesRequestBody {
  model: string;
  input: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  tool_choice: 'auto';
  store: false;
  stream?: boolean;
  max_output_tokens?: number;
  reasoning?: { effort: 'none' };
}

export interface BuiltResponsesRequest {
  body: ResponsesRequestBody;
  aliasToOriginal: Map<string, string>;
}

export function createResponsesTurnState(): ResponsesTurnState {
  return {
    text: '',
    emittedLength: 0,
    settled: false,
    webSearchUsed: false,
    webSearchAnnounced: false,
    citations: [],
    toolCalls: [],
  };
}

/**
 * Hosted web search runs inside one Responses API call. Function tools stay
 * on the same request so the orchestrator can still call them. Reasoning is
 * disabled only when those function tools are present, matching chat
 * completions; research calls that only search keep the model's default.
 */
export function buildResponsesRequest(input: {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  stream?: boolean;
}): BuiltResponsesRequest {
  const prepared = prepareTools(input.tools);
  const body: ResponsesRequestBody = {
    model: input.model,
    input: toResponsesInput(input.messages),
    tools: buildResponsesTools(prepared),
    tool_choice: 'auto',
    store: false,
  };

  if (input.maxTokens !== undefined) {
    body.max_output_tokens = input.maxTokens;
  }
  if (input.stream) {
    body.stream = true;
  }
  if ((prepared.tools?.length ?? 0) > 0) {
    body.reasoning = { effort: 'none' };
  }

  return { body, aliasToOriginal: prepared.aliasToOriginal };
}

export function applyResponsesStreamEvent(
  state: ResponsesTurnState,
  event: unknown,
  aliasToOriginal: Map<string, string>,
): StreamDelta[] {
  if (!isRecord(event) || typeof event.type !== 'string') {
    return [];
  }

  if (
    event.type === 'response.web_search_call.in_progress' ||
    event.type === 'response.web_search_call.searching'
  ) {
    state.webSearchUsed = true;
    if (state.webSearchAnnounced) {
      return [];
    }
    state.webSearchAnnounced = true;
    return [{ type: 'web_search' }];
  }

  if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
    state.text += event.delta;
    state.emittedLength += event.delta.length;
    return [{ type: 'text', text: event.delta }];
  }

  if (event.type === 'response.output_text_annotation.added') {
    rememberCitation(state, event.annotation);
    return [];
  }

  if (event.type === 'response.failed' || event.type === 'response.error') {
    state.failedMessage = readFailureMessage(event);
    return [];
  }

  if (event.type === 'response.incomplete') {
    ingestResponse(state, event.response, aliasToOriginal);
    if (state.text.length === 0 && !state.failedMessage) {
      state.failedMessage = 'OpenAI response was incomplete';
    }
    return finishTurn(state);
  }

  if (event.type === 'response.completed') {
    ingestResponse(state, event.response, aliasToOriginal);
    return finishTurn(state);
  }

  return [];
}

export function withWebCitations(text: string, citations: WebCitation[]): string {
  const seen = new Set<string>();
  const missing: WebCitation[] = [];

  for (const citation of citations) {
    const url = citation.url.trim();
    if (!url || seen.has(url) || text.includes(url)) {
      continue;
    }
    seen.add(url);
    missing.push({ url, title: citation.title.trim() || url });
  }

  if (missing.length === 0) {
    return text;
  }

  const lines = missing.map((citation) => {
    const title = citation.title.replace(/[\[\]]/g, '');
    return `- [${title}](${citation.url})`;
  });
  const sources = `Sources:\n${lines.join('\n')}`;
  const trimmed = text.trimEnd();
  return trimmed.length > 0 ? `${trimmed}\n\n${sources}` : sources;
}

function buildResponsesTools(prepared: PreparedTools): Array<Record<string, unknown>> {
  const tools: Array<Record<string, unknown>> = [
    { type: 'web_search', search_context_size: 'medium' },
  ];

  for (const tool of prepared.tools ?? []) {
    tools.push({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: 'object', properties: {} },
      strict: false,
    });
  }

  return tools;
}

function toResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (message.role === 'tool') {
      const text = messageText(message.content);
      const label = message.toolCallId ? `Tool result (${message.toolCallId})` : 'Tool result';
      return { type: 'message', role: 'user', content: `${label}: ${text}` };
    }

    return {
      type: 'message',
      role: message.role,
      content: toResponsesContent(message.content),
    };
  });
}

function toResponsesContent(
  content: ChatMessage['content'],
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return content;
  }

  return content.map((part) => toResponsesContentPart(part));
}

function toResponsesContentPart(part: ChatContentPart): Record<string, unknown> {
  if (part.type === 'text') {
    return { type: 'input_text', text: part.text };
  }

  return {
    type: 'input_image',
    image_url: part.imageUrl.url,
    detail: part.imageUrl.detail ?? 'auto',
  };
}

function messageText(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : extractTextFromParts(content);
}

function finishTurn(state: ResponsesTurnState): StreamDelta[] {
  if (state.settled) {
    return [];
  }
  state.settled = true;

  const finalText = withWebCitations(state.text, state.citations);
  const suffix = finalText.startsWith(state.text.slice(0, state.emittedLength))
    ? finalText.slice(state.emittedLength)
    : state.emittedLength === 0
      ? finalText
      : '';
  state.text = finalText;
  state.emittedLength = finalText.length;

  const deltas: StreamDelta[] = [];
  if (suffix.length > 0) {
    deltas.push({ type: 'text', text: suffix });
  }
  for (const toolCall of state.toolCalls) {
    deltas.push({ type: 'tool_call', toolCall });
  }
  return deltas;
}

function ingestResponse(
  state: ResponsesTurnState,
  response: unknown,
  aliasToOriginal: Map<string, string>,
): void {
  if (!isRecord(response)) {
    return;
  }

  const usage = readUsage(response.usage);
  if (usage) {
    state.usage = usage;
  }

  if (typeof response.output_text === 'string') {
    adoptLongerText(state, response.output_text);
  }

  if (!Array.isArray(response.output)) {
    return;
  }

  const toolCalls: ToolCall[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || typeof item.type !== 'string') {
      continue;
    }

    if (item.type === 'web_search_call') {
      state.webSearchUsed = true;
      continue;
    }

    if (item.type === 'function_call') {
      const name = typeof item.name === 'string' ? item.name : '';
      const callId =
        typeof item.call_id === 'string'
          ? item.call_id
          : typeof item.id === 'string'
            ? item.id
            : '';
      if (!name || !callId) {
        continue;
      }
      toolCalls.push({
        id: callId,
        name: aliasToOriginal.get(name) ?? name,
        arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
      });
      continue;
    }

    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isRecord(part)) {
          continue;
        }
        if (typeof part.text === 'string') {
          adoptLongerText(state, part.text);
        }
        if (Array.isArray(part.annotations)) {
          for (const annotation of part.annotations) {
            rememberCitation(state, annotation);
          }
        }
      }
    }
  }

  if (toolCalls.length > 0) {
    state.toolCalls = toolCalls;
  }
}

function adoptLongerText(state: ResponsesTurnState, next: string): void {
  if (next.length <= state.text.length) {
    return;
  }
  if (state.text.length === 0 || next.startsWith(state.text)) {
    state.text = next;
  }
}

function rememberCitation(state: ResponsesTurnState, annotation: unknown): void {
  if (!isRecord(annotation) || annotation.type !== 'url_citation') {
    return;
  }
  if (typeof annotation.url !== 'string' || annotation.url.trim().length === 0) {
    return;
  }
  const url = annotation.url.trim();
  if (state.citations.some((citation) => citation.url === url)) {
    return;
  }
  state.citations.push({
    url,
    title: typeof annotation.title === 'string' ? annotation.title : '',
  });
}

function readUsage(usage: unknown): CompletionResponse['usage'] | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }
  const promptTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const completionTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  const totalTokens =
    typeof usage.total_tokens === 'number' ? usage.total_tokens : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function readFailureMessage(event: Record<string, unknown>): string {
  const response = isRecord(event.response) ? event.response : undefined;
  const error = isRecord(response?.error)
    ? response.error
    : isRecord(event.error)
      ? event.error
      : undefined;
  if (error && typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }
  return 'OpenAI response failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
