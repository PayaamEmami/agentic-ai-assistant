import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  listByUser: vi.fn(),
  updateTitle: vi.fn(),
  deleteConversation: vi.fn(),
  listByConversation: vi.fn(),
}));

vi.mock('@aaa/db', () => ({
  getPool: vi.fn(),
  conversationRepository: {
    findById: mocks.findById,
    listByUser: mocks.listByUser,
    updateTitle: mocks.updateTitle,
    delete: mocks.deleteConversation,
  },
  messageRepository: {
    listByConversation: mocks.listByConversation,
  },
}));

import { AppError } from '../../lib/errors.js';
import { getConversation, updateConversationTitle } from './conversations.js';

describe('conversation access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a blank title before writing', async () => {
    mocks.findById.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', title: 'Old' });

    await expect(updateConversationTitle('user-1', 'conversation-1', '   ')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(mocks.updateTitle).not.toHaveBeenCalled();
  });

  it('rejects a conversation owned by someone else', async () => {
    mocks.findById.mockResolvedValue({ id: 'conversation-1', userId: 'other-user', title: 'Old' });

    await expect(getConversation('user-1', 'conversation-1')).rejects.toBeInstanceOf(AppError);
    expect(mocks.listByConversation).not.toHaveBeenCalled();
  });

  it('returns the owned conversation with its messages', async () => {
    mocks.findById.mockResolvedValue({ id: 'conversation-1', userId: 'user-1', title: 'Notes' });
    mocks.listByConversation.mockResolvedValue([{ id: 'message-1' }]);

    await expect(getConversation('user-1', 'conversation-1')).resolves.toEqual({
      id: 'conversation-1',
      title: 'Notes',
      messages: [{ id: 'message-1' }],
    });
  });
});
