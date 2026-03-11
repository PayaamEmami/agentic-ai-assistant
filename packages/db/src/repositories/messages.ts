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
      `INSERT INTO messages (id, conversation_id, role, content)
       VALUES ($1, $2, $3, $4)
       RETURNING id, conversation_id AS "conversationId", role, content, created_at AS "createdAt"`,
      [id, conversationId, role, JSON.stringify(content)],
    );
    return result.rows[0]!;
  },
};
