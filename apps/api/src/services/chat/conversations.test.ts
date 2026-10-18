import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listByUser: vi.fn(),
  update: vi.fn(),
  deleteConversation: vi.fn(),
  listByConversation: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  getPool: vi.fn(),
  conversationRepository: {
    findById: mocks.findById,
    listByUser: mocks.listByUser,
    update: mocks.update,
    delete: mocks.deleteConversation,
  },
  messageRepository: {
    listByConversation: mocks.listByConversation,
  },
}));

import { AppError } from '../../lib/errors.js';
import { getConversation, updateConversation } from './conversations.js';

describe('conversation access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a blank title before writing', async () => {
    mocks.findById.mockResolvedValue({
      id: 'conversation-1',
      userId: 'user-1',
      title: 'Old',
      chatModel: 'gpt-5.6-luna',
    });

    await expect(
      updateConversation('user-1', 'conversation-1', { title: '   ' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('updates the chat model without renaming the thread', async () => {
    mocks.findById.mockResolvedValue({
      id: 'conversation-1',
      userId: 'user-1',
      title: 'Notes',
      chatModel: 'gpt-5.6-luna',
    });
    mocks.update.mockResolvedValue({
      id: 'conversation-1',
      userId: 'user-1',
      title: 'Notes',
      chatModel: 'gpt-6.1-sol',
    });

    await expect(
      updateConversation('user-1', 'conversation-1', { chatModel: 'gpt-6.1-sol' }),
    ).resolves.toMatchObject({ chatModel: 'gpt-6.1-sol' });
    expect(mocks.update).toHaveBeenCalledWith('conversation-1', { chatModel: 'gpt-6.1-sol' });
  });

  it('writes a title and chat model in one update', async () => {
    mocks.findById.mockResolvedValue({
      id: 'conversation-1',
      userId: 'user-1',
      title: 'Notes',
      chatModel: 'gpt-5.6-luna',
    });
    mocks.update.mockResolvedValue({
      id: 'conversation-1',
      title: 'Planning',
      chatModel: 'gpt-6-luna',
    });

    await updateConversation('user-1', 'conversation-1', {
      title: 'Planning',
      chatModel: 'gpt-6-luna',
    });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith('conversation-1', {
      title: 'Planning',
      chatModel: 'gpt-6-luna',
    });
  });

  it('rejects a conversation owned by someone else', async () => {
    mocks.findById.mockResolvedValue({ id: 'conversation-1', userId: 'other-user', title: 'Old' });

    await expect(getConversation('user-1', 'conversation-1')).rejects.toBeInstanceOf(AppError);
    expect(mocks.listByConversation).not.toHaveBeenCalled();
  });

  it('returns the owned conversation with its messages', async () => {
    mocks.findById.mockResolvedValue({
      id: 'conversation-1',
      userId: 'user-1',
      title: 'Notes',
      chatModel: 'gpt-5.6-luna',
    });
    mocks.listByConversation.mockResolvedValue([{ id: 'message-1' }]);

    await expect(getConversation('user-1', 'conversation-1')).resolves.toEqual({
      id: 'conversation-1',
      title: 'Notes',
      chatModel: 'gpt-5.6-luna',
      messages: [{ id: 'message-1' }],
    });
  });
});
