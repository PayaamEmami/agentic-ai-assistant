import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: unknown[];
  createdAt: Date;
}

export interface MessageRepository {
  findById(id: string): Promise<Message | null>;
  listByConversation(conversationId: string, limit?: number, offset?: number): Promise<Message[]>;
  create(conversationId: string, role: string, content: unknown[]): Promise<Message>;
  updateToolResultStatus(
    id: string,
    toolExecutionId: string,
    status: string,
    output?: unknown,
  ): Promise<void>;
  updateBrowserSessionBlock(
    id: string,
    browserSessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void>;
}

export const messageRepository: MessageRepository = {
  async findById(id: string): Promise<Message | null> {
    const pool = getPool();
    const result = await pool.query<Message>(
      `SELECT id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
       FROM messages WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByConversation(conversationId: string, limit = 100, offset = 0): Promise<Message[]> {
    const pool = getPool();
    const result = await pool.query<Message>(
      `SELECT id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
       FROM messages WHERE conversation_id = $1
       ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset],
    );
    return result.rows;
  },

  async create(conversationId: string, role: string, content: unknown[]): Promise<Message> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<Message>(
      `WITH inserted AS (
         INSERT INTO messages (id, conversation_id, role, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
       ),
       touched AS (
         UPDATE conversations
         SET updated_at = NOW()
         WHERE id = $2
         RETURNING id
       )
       SELECT id, "conversationId", role, content, "createdAt"
       FROM inserted`,
      [id, conversationId, role, JSON.stringify(content)],
    );
    return result.rows[0]!;
  },

  async updateToolResultStatus(
    id: string,
    toolExecutionId: string,
    status: string,
    output?: unknown,
  ): Promise<void> {
    const existing = await messageRepository.findById(id);
    if (!existing) {
      return;
    }

    const nextContent = existing.content.map((block) => {
      if (
        block &&
        typeof block === 'object' &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === 'tool_result' &&
        (block as Record<string, unknown>).toolExecutionId === toolExecutionId
      ) {
        const nextBlock: Record<string, unknown> = {
          ...(block as Record<string, unknown>),
          status,
        };

        if (typeof output !== 'undefined') {
          nextBlock['output'] = output;
        }

        return nextBlock;
      }

      return block;
    });

    const pool = getPool();
    await pool.query(
      `UPDATE messages
       SET content = $1
       WHERE id = $2`,
      [JSON.stringify(nextContent), id],
    );
  },

  async updateBrowserSessionBlock(
    id: string,
    browserSessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const existing = await messageRepository.findById(id);
    if (!existing) {
      return;
    }

    const nextContent = existing.content.map((block) => {
      if (
        block &&
        typeof block === 'object' &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === 'browser_session' &&
        (block as Record<string, unknown>).browserSessionId === browserSessionId
      ) {
        return {
          ...(block as Record<string, unknown>),
          ...patch,
        };
      }

      return block;
    });

    const pool = getPool();
    await pool.query(
      `UPDATE messages
       SET content = $1
       WHERE id = $2`,
      [JSON.stringify(nextContent), id],
    );
  },
};
