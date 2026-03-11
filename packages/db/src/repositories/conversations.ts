import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<Conversation[]>;
  create(userId: string, title?: string): Promise<Conversation>;
  updateTitle(id: string, title: string): Promise<void>;
}

export const conversationRepository: ConversationRepository = {
  async findById(id: string): Promise<Conversation | null> {
    const pool = getPool();
    const result = await pool.query<Conversation>(
      `SELECT id, user_id AS "userId", title, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM conversations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByUser(userId: string, limit = 50, offset = 0): Promise<Conversation[]> {
    const pool = getPool();
    const result = await pool.query<Conversation>(
      `SELECT id, user_id AS "userId", title, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM conversations WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  },

  async create(userId: string, title?: string): Promise<Conversation> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<Conversation>(
      `INSERT INTO conversations (id, user_id, title)
       VALUES ($1, $2, $3)
       RETURNING id, user_id AS "userId", title, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, userId, title ?? null],
    );
    return result.rows[0]!;
  },

  async updateTitle(id: string, title: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2',
      [title, id],
    );
  },
};
