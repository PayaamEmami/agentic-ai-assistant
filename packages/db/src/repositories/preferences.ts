import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface PreferenceRow {
  id: string;
  userId: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface Preference extends PreferenceRow {}

export interface PreferenceRepository {
  findByUserAndKey(userId: string, key: string): Promise<Preference | null>;
  listByUser(userId: string): Promise<Preference[]>;
  upsert(userId: string, key: string, value: string): Promise<Preference>;
  delete(userId: string, key: string): Promise<void>;
}

export const preferenceRepository: PreferenceRepository = {
  async findByUserAndKey(userId: string, key: string): Promise<Preference | null> {
    const pool = getPool();
    const result = await pool.query<PreferenceRow>(
      `SELECT id, user_id AS "userId", key, value, updated_at AS "updatedAt"
       FROM preferences
       WHERE user_id = $1 AND key = $2`,
      [userId, key],
    );
    return result.rows[0] ?? null;
  },

  async listByUser(userId: string): Promise<Preference[]> {
    const pool = getPool();
    const result = await pool.query<PreferenceRow>(
      `SELECT id, user_id AS "userId", key, value, updated_at AS "updatedAt"
       FROM preferences
       WHERE user_id = $1
       ORDER BY key ASC`,
      [userId],
    );
    return result.rows;
  },

  async upsert(userId: string, key: string, value: string): Promise<Preference> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<PreferenceRow>(
      `INSERT INTO preferences (id, user_id, key, value)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()
       RETURNING id, user_id AS "userId", key, value, updated_at AS "updatedAt"`,
      [id, userId, key, value],
    );
    return result.rows[0]!;
  },

  async delete(userId: string, key: string): Promise<void> {
    const pool = getPool();
    await pool.query('DELETE FROM preferences WHERE user_id = $1 AND key = $2', [userId, key]);
  },
};
