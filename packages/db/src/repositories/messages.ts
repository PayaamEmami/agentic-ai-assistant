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
  updateToolResultBlock(
    id: string,
    toolExecutionId: string,
    patch: {
      status?: string;
      output?: unknown;
      detail?: string;
    },
  ): Promise<void>;
  replaceAssistantText(id: string, text: string): Promise<void>;
  appendContentBlocks(id: string, blocks: unknown[]): Promise<void>;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
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
       ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3`,
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

  async updateToolResultBlock(
    id: string,
    toolExecutionId: string,
    patch: {
      status?: string;
      output?: unknown;
      detail?: string;
    },
  ): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<Message>(
        `SELECT id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
         FROM messages
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const existing = result.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
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
          };

          if (hasOwn(patch, 'status')) {
            if (typeof patch.status === 'undefined') {
              delete nextBlock['status'];
            } else {
              nextBlock['status'] = patch.status;
            }
          }

          if (hasOwn(patch, 'output')) {
            if (typeof patch.output === 'undefined') {
              delete nextBlock['output'];
            } else {
              nextBlock['output'] = patch.output;
            }
          }

          if (hasOwn(patch, 'detail')) {
            if (typeof patch.detail === 'undefined') {
              delete nextBlock['detail'];
            } else {
              nextBlock['detail'] = patch.detail;
            }
          }

          return nextBlock;
        }

        return block;
      });

      await client.query(
        `UPDATE messages
         SET content = $1
         WHERE id = $2`,
        [JSON.stringify(nextContent), id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async replaceAssistantText(id: string, text: string): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<Message>(
        `SELECT id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
         FROM messages
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const existing = result.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return;
      }

      let replaced = false;
      const nextContent = existing.content.map((block) => {
        if (
          !replaced &&
          block &&
          typeof block === 'object' &&
          !Array.isArray(block) &&
          (block as Record<string, unknown>).type === 'text'
        ) {
          replaced = true;
          return { ...(block as Record<string, unknown>), text };
        }
        return block;
      });

      const finalContent = replaced ? nextContent : [{ type: 'text', text }, ...existing.content];

      await client.query(
        `UPDATE messages
         SET content = $1
         WHERE id = $2`,
        [JSON.stringify(finalContent), id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async appendContentBlocks(id: string, blocks: unknown[]): Promise<void> {
    if (blocks.length === 0) {
      return;
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<Message>(
        `SELECT id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"
         FROM messages
         WHERE id = $1
         FOR UPDATE`,
        [id],
      );
      const existing = result.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return;
      }

      const nextContent = [...existing.content, ...blocks];

      await client.query(
        `UPDATE messages
         SET content = $1
         WHERE id = $2`,
        [JSON.stringify(nextContent), id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
