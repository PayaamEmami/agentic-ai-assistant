import { describe, expect, it } from 'vitest';
import {
  appendAssistantTextDelta,
  appendAssistantThinkingDelta,
  buildConversationTitle,
  extractCitations,
  finalizeAssistantMessage,
  hasSettledAssistantContent,
  mergeConversations,
  mergeRemoteConversationMessages,
  normalizeMessage,
  patchMessagesToolResult,
  setAssistantStage,
  upsertVoiceMessageInList,
  type ChatMessage,
  type ConversationSummary,
} from './index';

describe('chat model', () => {
  it('normalizes malformed message content into displayable blocks', () => {
    const message = normalizeMessage({
      id: 'message-1',
      role: 'unexpected',
      content: [
        'plain text',
        { type: 'tool_result', toolExecutionId: 'tool-1', status: 'weird', output: { ok: true } },
        { type: 'citation', sourceId: 'source-1', excerpt: 123 },
        { unknown: true },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(message.role).toBe('assistant');
    expect(message.content).toEqual([
      { type: 'text', text: 'plain text' },
      {
        type: 'tool_result',
        toolExecutionId: 'tool-1',
        toolName: undefined,
        status: 'completed',
        detail: undefined,
        output: { ok: true },
      },
      {
        type: 'citation',
        sourceId: 'source-1',
        title: undefined,
        excerpt: undefined,
        uri: undefined,
      },
      { type: 'text', text: '{"unknown":true}' },
    ]);
  });

  it('merges remote conversations over local copies and sorts by updated time', () => {
    const local: ConversationSummary[] = [
      conversation('local-only', 'Local only', '2026-01-02T00:00:00.000Z'),
      conversation('shared', 'Old local', '2026-01-01T00:00:00.000Z'),
    ];
    const remote: ConversationSummary[] = [
      conversation('shared', 'Remote wins', '2026-01-03T00:00:00.000Z'),
      conversation('remote-only', 'Remote only', '2026-01-04T00:00:00.000Z'),
    ];

    expect(mergeConversations(local, remote)).toEqual([
      conversation('remote-only', 'Remote only', '2026-01-04T00:00:00.000Z'),
      conversation('shared', 'Remote wins', '2026-01-03T00:00:00.000Z'),
      conversation('local-only', 'Local only', '2026-01-02T00:00:00.000Z'),
    ]);
  });

  it('builds compact conversation titles from user text', () => {
    expect(buildConversationTitle('  hello\n\nthere  ')).toBe('hello there');
    expect(buildConversationTitle('')).toBe('Untitled conversation');
    expect(buildConversationTitle('a'.repeat(100))).toBe(`${'a'.repeat(77)}...`);
  });

  it('extracts citations with stable ids and display fallbacks', () => {
    const messages: ChatMessage[] = [
      {
        id: 'message-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [
          { type: 'text', text: 'Answer' },
          { type: 'citation', sourceId: 'source-1', excerpt: 'One' },
          { type: 'citation', title: 'Named source', excerpt: 'Two', uri: 'https://example.com' },
        ],
      },
    ];

    expect(extractCitations(messages)).toEqual([
      {
        id: 'message-1-1',
        title: 'source-1',
        excerpt: 'One',
        uri: undefined,
        sourceId: 'source-1',
      },
      {
        id: 'message-1-2',
        title: 'Named source',
        excerpt: 'Two',
        uri: 'https://example.com',
        sourceId: undefined,
      },
    ]);
  });

  it('patches matching tool result blocks without changing untouched messages', () => {
    const messages: ChatMessage[] = [
      {
        id: 'message-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [
          {
            type: 'tool_result',
            toolExecutionId: 'tool-1',
            status: 'running',
            detail: 'Working',
            output: { old: true },
          },
        ],
      },
      {
        id: 'message-2',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [{ type: 'text', text: 'unchanged' }],
      },
    ];

    const patched = patchMessagesToolResult(messages, 'tool-1', {
      status: 'completed',
      detail: undefined,
      output: { ok: true },
    });

    expect(patched).not.toBe(messages);
    expect(patched[1]).toBe(messages[1]);
    expect(patched[0]?.content).toEqual([
      {
        type: 'tool_result',
        toolExecutionId: 'tool-1',
        status: 'completed',
        output: { ok: true },
      },
    ]);
    expect(patchMessagesToolResult(messages, undefined, { status: 'completed' })).toBe(messages);
  });

  it('upserts voice messages by adding or replacing text content', () => {
    const messages: ChatMessage[] = [
      {
        id: 'voice-1',
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [
          { type: 'text', text: 'old transcript' },
          { type: 'citation', title: 'Keep me', excerpt: 'Source' },
        ],
      },
    ];

    const updated = upsertVoiceMessageInList(messages, 'voice-1', 'assistant', 'new transcript');
    const appended = upsertVoiceMessageInList(updated, 'voice-2', 'user', 'hello');

    expect(updated[0]).toMatchObject({
      id: 'voice-1',
      role: 'assistant',
      presentation: { animateText: true },
      content: [
        { type: 'text', text: 'new transcript' },
        { type: 'citation', title: 'Keep me', excerpt: 'Source' },
      ],
    });
    expect(appended).toHaveLength(2);
    expect(appended[1]).toMatchObject({
      id: 'voice-2',
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('treats non-empty assistant content as settled even without streamed text', () => {
    expect(
      hasSettledAssistantContent({
        id: 'message-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [{ type: 'text', text: '' }],
      }),
    ).toBe(false);
    expect(
      hasSettledAssistantContent({
        id: 'message-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [{ type: 'status', status: 'interrupted', label: 'Agent stopped' }],
      }),
    ).toBe(true);
  });

  it('finalizes a streaming assistant message even if the socket never delivered text', () => {
    const streaming: ChatMessage[] = [
      {
        id: 'message-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [],
        presentation: { streaming: true, activeStage: 'routing' },
      },
    ];

    const finalized = finalizeAssistantMessage(streaming, 'message-1', {
      fullText: 'The diagram shows superposition.',
    });

    expect(finalized[0]).toMatchObject({
      id: 'message-1',
      content: [{ type: 'text', text: 'The diagram shows superposition.' }],
      presentation: { streaming: false, activeStage: 'done' },
    });
    expect(
      appendAssistantTextDelta(finalized, 'message-1', ' late token'),
    ).toBe(finalized);
    expect(appendAssistantThinkingDelta(finalized, 'message-1', 'answering', 'hmm')).toBe(
      finalized,
    );
    expect(setAssistantStage(finalized, 'message-1', 'answering')).toBe(finalized);
    expect(setAssistantStage(streaming, 'message-1', 'done')[0]?.presentation).toMatchObject({
      streaming: true,
      activeStage: 'done',
    });
  });

  it('inserts a finalized assistant message when the live placeholder was never mounted', () => {
    const finalized = finalizeAssistantMessage([], 'message-1', { fullText: 'Done.' });

    expect(finalized).toHaveLength(1);
    expect(finalized[0]).toMatchObject({
      id: 'message-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Done.' }],
      presentation: { streaming: false, activeStage: 'done' },
    });
  });

  it('merges a remote snapshot without dropping an in-flight local turn', () => {
    const local: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:01.000Z',
        content: [{ type: 'text', text: 'partial answer' }],
        presentation: { streaming: true, activeStage: 'answering' },
      },
      {
        id: 'local-user-pending',
        role: 'user',
        createdAt: '2026-01-01T00:00:02.000Z',
        content: [{ type: 'text', text: 'follow up' }],
      },
    ];
    const remote: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: [{ type: 'text', text: 'first' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:01.000Z',
        content: [{ type: 'text', text: '' }],
      },
    ];

    const merged = mergeRemoteConversationMessages(local, remote);

    expect(merged).toHaveLength(3);
    expect(merged[1]).toBe(local[1]);
    expect(merged[2]?.id).toBe('local-user-pending');

    const settledRemote: ChatMessage[] = [
      remote[0]!,
      {
        id: 'assistant-1',
        role: 'assistant',
        createdAt: '2026-01-01T00:00:01.000Z',
        content: [{ type: 'text', text: 'complete answer' }],
      },
    ];
    const settled = mergeRemoteConversationMessages(local, settledRemote);
    expect(settled[1]?.content).toEqual([{ type: 'text', text: 'complete answer' }]);
    expect(settled[2]?.id).toBe('local-user-pending');
  });
});

function conversation(id: string, title: string, updatedAt: string): ConversationSummary {
  return {
    id,
    title,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}
