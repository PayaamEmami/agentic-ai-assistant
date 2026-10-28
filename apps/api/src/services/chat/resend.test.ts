import { setTimeout as delay } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentOrchestrator, ChatProvider } from '@aaa/ai';
import type { AppConfig } from '../../config.js';
import type { ChatEventPublisher } from './event-publisher.js';
import type { RetrievalBridge } from '../retrieval/bridge.js';
import type { PersonalizationService } from '../personalization/service.js';
import { ChatRunRegistry } from './run-registry.js';

const mocks = vi.hoisted(() => ({
  findConversationById: vi.fn(),
  updateConversation: vi.fn(),
  findMessageById: vi.fn(),
  listByConversation: vi.fn(),
  deleteAfter: vi.fn(),
  setContent: vi.fn(),
  failNonTerminalAfter: vi.fn(),
  decideApproval: vi.fn(),
  createAssistantPlaceholder: vi.fn(),
  generateAssistantTurn: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  getPool: vi.fn(),
  conversationRepository: {
    findById: mocks.findConversationById,
    update: mocks.updateConversation,
  },
  messageRepository: {
    findById: mocks.findMessageById,
    listByConversation: mocks.listByConversation,
    deleteAfter: mocks.deleteAfter,
    setContent: mocks.setContent,
  },
  toolExecutionRepository: {
    failNonTerminalAfter: mocks.failNonTerminalAfter,
  },
  approvalRepository: {
    decide: mocks.decideApproval,
  },
}));

vi.mock('./turn-runner.js', () => ({
  CHAT_HISTORY_LIMIT: 20,
  createAssistantPlaceholder: mocks.createAssistantPlaceholder,
  generateAssistantTurn: mocks.generateAssistantTurn,
}));

import { ChatService } from './service.js';

const userId = 'user-1';
const conversationId = 'conversation-1';
const messageId = 'message-1';
const laterMessageId = 'message-2';
const assistantId = 'assistant-1';
const clientRunId = '11111111-1111-4111-8111-111111111111';
const createdAt = new Date('2026-01-01T00:00:00.000Z');
const attachment = { type: 'attachment_ref', attachmentId: 'file-1', fileName: 'notes.pdf' };

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    userId,
    title: 'Hello',
    chatModel: 'gpt-6-luna',
    isAutomation: false,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function userMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: messageId,
    conversationId,
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }, attachment],
    createdAt,
    ...overrides,
  };
}

function createService(registry: ChatRunRegistry, runSettleTimeoutMs = 5_000) {
  return new ChatService({
    config: {} as AppConfig,
    retrievalBridge: {} as RetrievalBridge,
    modelProvider: {} as ChatProvider,
    agentOrchestrator: {} as AgentOrchestrator,
    personalizationService: {} as PersonalizationService,
    runRegistry: registry,
    eventPublisher: { error: vi.fn() } as unknown as ChatEventPublisher,
    enqueueToolExecutionJob: vi.fn(),
    runSettleTimeoutMs,
  });
}

describe('ChatService.resendFromMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findConversationById.mockResolvedValue(conversation());
    mocks.findMessageById.mockResolvedValue(userMessage());
    mocks.listByConversation.mockResolvedValue([
      userMessage(),
      {
        id: laterMessageId,
        conversationId,
        role: 'assistant',
        content: [{ type: 'text', text: 'Earlier reply' }],
        createdAt: new Date('2026-01-01T00:00:01.000Z'),
      },
    ]);
    mocks.failNonTerminalAfter.mockResolvedValue([
      { id: 'tool-1', approvalId: 'approval-1' },
      { id: 'tool-2', approvalId: null },
    ]);
    mocks.decideApproval.mockResolvedValue({ id: 'approval-1', status: 'rejected' });
    mocks.deleteAfter.mockResolvedValue(1);
    mocks.setContent.mockResolvedValue(undefined);
    mocks.updateConversation.mockImplementation(async (_id: string, patch: { title?: string }) =>
      conversation({ title: patch.title ?? 'Hello' }),
    );
    mocks.createAssistantPlaceholder.mockResolvedValue(assistantId);
    mocks.generateAssistantTurn.mockResolvedValue({
      conversationId,
      messageId: assistantId,
      assistantText: 'ok',
    });
  });

  it('truncates later messages, keeps attachments, and starts a new turn', async () => {
    const registry = new ChatRunRegistry();
    const service = createService(registry);

    await expect(
      service.resendFromMessage(userId, conversationId, messageId, '  Revised  ', clientRunId),
    ).resolves.toEqual({
      conversationId,
      messageId: assistantId,
    });

    expect(mocks.failNonTerminalAfter).toHaveBeenCalledWith(
      conversationId,
      createdAt,
      messageId,
      { reason: 'message_resent' },
    );
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1);
    expect(mocks.decideApproval).toHaveBeenCalledWith('approval-1', 'rejected');
    expect(mocks.deleteAfter).toHaveBeenCalledWith(conversationId, createdAt, messageId);
    expect(mocks.setContent).toHaveBeenCalledWith(messageId, [
      { type: 'text', text: 'Revised' },
      attachment,
    ]);
    expect(mocks.updateConversation).toHaveBeenCalledWith(conversationId, { title: 'Revised' });
    expect(mocks.generateAssistantTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        requestContent: 'Revised',
        assistantMessageId: assistantId,
        conversation: expect.objectContaining({ id: conversationId, title: 'Revised' }),
      }),
    );

    await vi.waitFor(() => {
      expect(registry.get(clientRunId)).toBeUndefined();
    });
  });

  it('leaves a renamed conversation title unchanged', async () => {
    mocks.findConversationById.mockResolvedValue(conversation({ title: 'Custom name' }));
    const service = createService(new ChatRunRegistry());

    await service.resendFromMessage(userId, conversationId, messageId, 'Revised', clientRunId);

    expect(mocks.updateConversation).not.toHaveBeenCalled();
  });

  it('does not retitle when a later message is edited', async () => {
    const second = userMessage({
      id: 'message-2',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    });
    mocks.findMessageById.mockResolvedValue(second);
    mocks.listByConversation.mockResolvedValue([userMessage(), second]);
    const service = createService(new ChatRunRegistry());

    await service.resendFromMessage(userId, conversationId, 'message-2', 'Different', clientRunId);

    expect(mocks.deleteAfter).toHaveBeenCalled();
    expect(mocks.updateConversation).not.toHaveBeenCalled();
  });

  it('rejects a non-user message without aborting the active run', async () => {
    const registry = new ChatRunRegistry();
    const run = registry.start('live-run', userId, conversationId);
    mocks.findMessageById.mockResolvedValue(userMessage({ role: 'assistant' }));
    const service = createService(registry);

    await expect(
      service.resendFromMessage(userId, conversationId, messageId, 'Revised', clientRunId),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'MESSAGE_NOT_EDITABLE',
    });
    expect(run.controller.signal.aborted).toBe(false);
    expect(mocks.deleteAfter).not.toHaveBeenCalled();
  });

  it('rejects another user without truncating', async () => {
    mocks.findConversationById.mockResolvedValue(conversation({ userId: 'someone-else' }));
    const service = createService(new ChatRunRegistry());

    await expect(
      service.resendFromMessage(userId, conversationId, messageId, 'Revised', clientRunId),
    ).rejects.toMatchObject({ statusCode: 404, code: 'CONVERSATION_NOT_FOUND' });
    expect(mocks.findMessageById).not.toHaveBeenCalled();
    expect(mocks.deleteAfter).not.toHaveBeenCalled();
  });

  it('rejects automation conversations', async () => {
    mocks.findConversationById.mockResolvedValue(conversation({ isAutomation: true }));
    const service = createService(new ChatRunRegistry());

    await expect(
      service.resendFromMessage(userId, conversationId, messageId, 'Revised', clientRunId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AUTOMATION_CONVERSATION' });
    expect(mocks.deleteAfter).not.toHaveBeenCalled();
  });

  it('does not truncate while a run is still active', async () => {
    const registry = new ChatRunRegistry();
    const run = registry.start('live-run', userId, conversationId);
    const service = createService(registry, 20);

    await expect(
      service.resendFromMessage(userId, conversationId, messageId, 'Revised', clientRunId),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONVERSATION_BUSY' });

    expect(run.controller.signal.aborted).toBe(true);
    expect(registry.get(clientRunId)).toBeUndefined();
    expect(mocks.deleteAfter).not.toHaveBeenCalled();
    expect(mocks.generateAssistantTurn).not.toHaveBeenCalled();
  });

  it('waits for the in-flight run to finish before truncating', async () => {
    const registry = new ChatRunRegistry();
    registry.start('live-run', userId, conversationId);
    const service = createService(registry);
    const pending = service.resendFromMessage(
      userId,
      conversationId,
      messageId,
      'Revised',
      clientRunId,
    );

    await delay(10);
    registry.finish('live-run');

    await expect(pending).resolves.toEqual({
      conversationId,
      messageId: assistantId,
    });
    expect(mocks.deleteAfter).toHaveBeenCalled();
  });
});
