import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  isAutomation: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationRepository {
  findById(id: string): Promise<Conversation | null>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<Conversation[]>;
  create(userId: string, title?: string, isAutomation?: boolean): Promise<Conversation>;
  updateTitle(id: string, title: string): Promise<Conversation | null>;
  delete(id: string): Promise<boolean>;
}

const SELECT_FIELDS = `id,
                       user_id AS "userId",
                       title,
                       is_automation AS "isAutomation",
                       created_at AS "createdAt",
                       updated_at AS "updatedAt"`;

export const conversationRepository: ConversationRepository = {
  async findById(id: string): Promise<Conversation | null> {
    const pool = getPool();
    const result = await pool.query<Conversation>(
      `SELECT ${SELECT_FIELDS}
       FROM conversations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  /** Sidebar history. Automation runs are excluded so they stay out of chat history. */
  async listByUser(userId: string, limit = 50, offset = 0): Promise<Conversation[]> {
    const pool = getPool();
    const result = await pool.query<Conversation>(
      `SELECT ${SELECT_FIELDS}
       FROM conversations WHERE user_id = $1 AND NOT is_automation
       ORDER BY updated_at DESC, created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  },

  async create(
    userId: string,
    title?: string,
    isAutomation = false,
  ): Promise<Conversation> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<Conversation>(
      `INSERT INTO conversations (id, user_id, title, is_automation)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SELECT_FIELDS}`,
      [id, userId, title ?? null, isAutomation],
    );
    return result.rows[0]!;
  },

  async updateTitle(id: string, title: string): Promise<Conversation | null> {
    const pool = getPool();
    const result = await pool.query<Conversation>(
      `UPDATE conversations
       SET title = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING ${SELECT_FIELDS}`,
      [title, id],
    );
    return result.rows[0] ?? null;
  },

  async delete(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM conversations WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
