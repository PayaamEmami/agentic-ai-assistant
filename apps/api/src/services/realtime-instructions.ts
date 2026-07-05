import { buildSystemPrompt, type PromptToolContext } from '@aaa/ai';
import type { messageRepository } from '@aaa/db';
import type { AvailableTool } from './tools-loader.js';

const MAX_HISTORY_CHARS = 1_800;

type DbMessage = Awaited<ReturnType<typeof messageRepository.listByConversation>>[number];

export function extractMessageText(content: unknown[]): string {
  const textParts: string[] = [];

  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      continue;
    }

    const candidate = block as { type?: unknown; text?: unknown };
    if (
      (candidate.type === 'text' || candidate.type === 'transcript') &&
      typeof candidate.text === 'string'
    ) {
      textParts.push(candidate.text.trim());
      continue;
    }
  }

  return textParts.filter(Boolean).join('\n').trim();
}

function summarizeHistory(messages: DbMessage[]): string {
  const historyLines = messages
    .map((message) => {
      const text = extractMessageText(message.content);
      if (!text) {
        return null;
      }

      const speaker =
        message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : null;

      if (!speaker) {
        return null;
      }

      return `${speaker}: ${text.replace(/\s+/g, ' ').trim()}`;
    })
    .filter((line): line is string => line !== null);

  if (historyLines.length === 0) {
    return '';
  }

  const joined = historyLines.join('\n');
  if (joined.length <= MAX_HISTORY_CHARS) {
    return joined;
  }

  return joined.slice(joined.length - MAX_HISTORY_CHARS).trimStart();
}

export function toRealtimeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool';
}

function toRealtimePromptToolContexts(tools: AvailableTool[]): PromptToolContext[] {
  return tools.map((tool) => ({
    name: toRealtimeToolName(tool.name),
    description: tool.description,
    requiresApproval: tool.requiresApproval,
  }));
}

function toRealtimeToolDefinitions(tools: AvailableTool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    name: toRealtimeToolName(tool.name),
    description: tool.description,
    parameters: tool.parameters,
  }));
}

export function buildRealtimeInstructions(
  personalContext: string | null,
  recentMessages: DbMessage[],
  availableTools: AvailableTool[],
  retrievalContextSections: string[] = [],
): string {
  const hasTools = availableTools.length > 0;
  const hasRetrieval = retrievalContextSections.length > 0;
  const basePrompt = buildSystemPrompt({
    personalContext: personalContext ?? undefined,
    availableTools: hasTools ? toRealtimePromptToolContexts(availableTools) : undefined,
    includeToolGuidance: hasTools,
    includeRetrievalGuidance: hasRetrieval,
  });

  const sections = [
    basePrompt,
    'Live voice mode constraints:',
    '- You are in a realtime spoken conversation.',
    '- Respond naturally, warmly, and conversationally.',
    '- Keep spoken answers concise by default unless the user asks for depth.',
    hasTools
      ? '- You may invoke the available tools when the user asks for something that requires them. Tools marked as requiring approval will pause the conversation until the user responds in the UI; acknowledge briefly and wait for their decision.'
      : '- No tools are available this session; if a request requires tools, say so and offer to continue in text chat.',
  ];

  if (hasRetrieval) {
    const numbered = retrievalContextSections
      .map((section, index) => `[${index + 1}] ${section}`)
      .join('\n\n');
    sections.push(
      `Retrieved context for this turn (cite as [Source N] only when you use the content):\n${numbered}`,
    );
  }

  const historySummary = summarizeHistory(recentMessages);
  if (historySummary) {
    sections.push(`Recent conversation context:\n${historySummary}`);
  }

  return sections.join('\n\n');
}

export function buildRealtimeSessionConfig(
  model: string,
  voice: string,
  transcriptionModel: string,
  instructions: string,
  tools: AvailableTool[],
): Record<string, unknown> {
  const hasTools = tools.length > 0;
  return {
    type: 'realtime',
    model,
    instructions,
    tools: hasTools ? toRealtimeToolDefinitions(tools) : [],
    tool_choice: hasTools ? 'auto' : 'none',
    audio: {
      input: {
        noise_reduction: {
          type: 'near_field',
        },
        transcription: {
          model: transcriptionModel,
        },
        turn_detection: {
          type: 'server_vad',
          create_response: false,
          interrupt_response: true,
          prefix_padding_ms: 300,
          silence_duration_ms: 450,
        },
      },
      output: {
        voice,
      },
    },
  };
}
