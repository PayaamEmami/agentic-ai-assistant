import { WORKSPACE_SEARCH_TOOL_NAME } from '@aaa/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config.js';
import type { RetrievalBridge, RetrievalResponse } from '../retrieval/bridge.js';
import type { PersonalizationService } from '../personalization/service.js';

const mocks = vi.hoisted(() => ({
  findMessageById: vi.fn(),
  findConversationById: vi.fn(),
  replaceAssistantText: vi.fn(),
  appendContentBlocks: vi.fn(),
  loadAvailableTools: vi.fn(),
  enqueueToolExecutionJob: vi.fn(),
  search: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  getPool: vi.fn(),
  messageRepository: {
    findById: mocks.findMessageById,
    replaceAssistantText: mocks.replaceAssistantText,
    appendContentBlocks: mocks.appendContentBlocks,
  },
  conversationRepository: {
    findById: mocks.findConversationById,
  },
}));

vi.mock('@aaa/observability', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    addLogContext: vi.fn(),
    getLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  };
});

vi.mock('../../ws/connections.js', () => ({
  broadcast: vi.fn(),
}));

vi.mock('../tools/loader.js', () => ({
  loadAvailableTools: mocks.loadAvailableTools,
}));

import { VoiceService } from './service.js';

const userId = 'user-1';
const conversationId = 'conversation-1';
const voiceTurnId = '11111111-1111-4111-8111-111111111111';

const retrieval: RetrievalResponse = {
  results: [
    {
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      sourceId: 'source-1',
      content: 'quantum notes',
      score: 0.9,
      metadata: {},
      documentTitle: 'Notes',
      uri: null,
    },
  ],
  citations: [],
};

describe('VoiceService workspace search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMessageById.mockResolvedValue({
      id: voiceTurnId,
      conversationId,
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
    });
    mocks.findConversationById.mockResolvedValue({
      id: conversationId,
      userId,
    });
    mocks.loadAvailableTools.mockResolvedValue([
      {
        name: WORKSPACE_SEARCH_TOOL_NAME,
        description: 'Search notes',
        parameters: {},
        requiresApproval: false,
      },
    ]);
    mocks.search.mockResolvedValue(retrieval);
  });

  it('runs search_workspace inline and cites the result when the turn completes', async () => {
    const service = new VoiceService(
      {} as AppConfig,
      {} as PersonalizationService,
      { search: mocks.search } as unknown as RetrievalBridge,
      { enqueueToolExecutionJob: mocks.enqueueToolExecutionJob },
    );

    const submitted = await service.submitToolCall(userId, {
      conversationId,
      voiceTurnId,
      callId: 'call-1',
      toolName: WORKSPACE_SEARCH_TOOL_NAME,
      argumentsJson: '{"query":"notes"}',
    });

    expect(mocks.enqueueToolExecutionJob).not.toHaveBeenCalled();
    expect(mocks.search).toHaveBeenCalledWith('notes', userId, 6);
    expect(submitted).toMatchObject({ status: 'completed' });
    expect(submitted.output).toContain('[Source 1]');
    expect(submitted.output).toContain('quantum notes');

    await service.completeTurn(userId, voiceTurnId, 'See [Source 1].');

    expect(mocks.appendContentBlocks).toHaveBeenCalledWith(voiceTurnId, [
      expect.objectContaining({
        type: 'citation',
        sourceId: 'source-1',
        title: 'Notes',
      }),
    ]);
  });
});
