import { buildSystemPrompt, type PromptToolContext } from '@aaa/ai';
import type { messageRepository } from '@aaa/db';
import type { AvailableTool } from '../tools/loader.js';

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

export function latestUserMessageText(
  messages: Array<{ role: string; content: unknown[] }>,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') {
      continue;
    }

    const text = extractMessageText(message.content);
    if (text.length > 0) {
      return text;
    }
  }

  return '';
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

function toRealtimePromptToolContexts(
  tools: AvailableTool[],
  toolName: (name: string) => string,
): PromptToolContext[] {
  return tools.map((tool) => ({
    name: toolName(tool.name),
    description: tool.description,
    requiresApproval: tool.requiresApproval,
  }));
}

export function buildRealtimeInstructions(
  personalContext: string | null,
  recentMessages: DbMessage[],
  availableTools: AvailableTool[],
  toolName: (name: string) => string,
): string {
  const hasTools = availableTools.length > 0;
  const basePrompt = buildSystemPrompt({
    personalContext: personalContext ?? undefined,
    availableTools: hasTools ? toRealtimePromptToolContexts(availableTools, toolName) : undefined,
    includeToolGuidance: hasTools,
    includeRetrievalGuidance: false,
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
    '- When the user asks about their own notes, files, attachments, or synced sources, call search_workspace and cite matches as [Source N].',
  ];

  const historySummary = summarizeHistory(recentMessages);
  if (historySummary) {
    sections.push(`Recent conversation context:\n${historySummary}`);
  }

  return sections.join('\n\n');
}
