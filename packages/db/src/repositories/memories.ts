import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface MemoryRow {
  id: string;
  userId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Memory extends MemoryRow {}

export interface MemoryRepository {
  findById(id: string): Promise<Memory | null>;
  listByUser(userId: string, kind?: string): Promise<Memory[]>;
  create(
    userId: string,
    kind: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<Memory>;
  update(id: string, content: string, metadata: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  search(userId: string, query: string, limit: number): Promise<Memory[]>;
}

export const memoryRepository: MemoryRepository = {
  async findById(id: string): Promise<Memory | null> {
    const pool = getPool();
    const result = await pool.query<MemoryRow>(
      `SELECT id, user_id AS "userId", kind, content, metadata,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM memories
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByUser(userId: string, kind?: string): Promise<Memory[]> {
    const pool = getPool();
    if (typeof kind === 'undefined') {
      const result = await pool.query<MemoryRow>(
        `SELECT id, user_id AS "userId", kind, content, metadata,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM memories
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [userId],
      );
      return result.rows;
    }

    const result = await pool.query<MemoryRow>(
      `SELECT id, user_id AS "userId", kind, content, metadata,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM memories
       WHERE user_id = $1 AND kind = $2
       ORDER BY updated_at DESC`,
      [userId, kind],
    );
    return result.rows;
  },

  async create(
    userId: string,
    kind: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<Memory> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<MemoryRow>(
      `INSERT INTO memories (id, user_id, kind, content, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id AS "userId", kind, content, metadata,
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, userId, kind, content, JSON.stringify(metadata)],
    );
    return result.rows[0]!;
  },

  async update(id: string, content: string, metadata: Record<string, unknown>): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE memories SET content = $1, metadata = $2, updated_at = NOW() WHERE id = $3',
      [content, JSON.stringify(metadata), id],
    );
  },

  async delete(id: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM memories WHERE id = $1', [id]);
  },

  async search(userId: string, query: string, limit: number): Promise<Memory[]> {
    const pool = getPool();
    const pattern = `%${query}%`;
    const result = await pool.query<MemoryRow>(
      `SELECT id, user_id AS "userId", kind, content, metadata,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM memories
       WHERE user_id = $1 AND content ILIKE $2
       ORDER BY updated_at DESC
       LIMIT $3`,
      [userId, pattern, limit],
    );
    return result.rows;
  },
};
