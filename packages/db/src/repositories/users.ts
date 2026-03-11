import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(email: string, displayName: string): Promise<User>;
}

export const userRepository: UserRepository = {
  async findById(id: string): Promise<User | null> {
    const pool = getPool();
    const result = await pool.query<User>(
      'SELECT id, email, display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const pool = getPool();
    const result = await pool.query<User>(
      'SELECT id, email, display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt" FROM users WHERE email = $1',
      [email],
    );
    return result.rows[0] ?? null;
  },

  async create(email: string, displayName: string): Promise<User> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<User>(
      `INSERT INTO users (id, email, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name AS "displayName", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, email, displayName],
    );
    return result.rows[0]!;
  },
};
