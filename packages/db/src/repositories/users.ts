import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UserRow extends User {
  passwordHash: string | null;
}

export interface UserAuthRecord extends User {
  passwordHash: string | null;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAuthByEmail(email: string): Promise<UserAuthRecord | null>;
  create(email: string, displayName: string, passwordHash?: string | null): Promise<User>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export const userRepository: UserRepository = {
  async findById(id: string): Promise<User | null> {
    const pool = getPool();
    const result = await pool.query<UserRow>(
      `SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toUser(row) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const record = await userRepository.findAuthByEmail(email);
    return record
      ? {
          id: record.id,
          email: record.email,
          displayName: record.displayName,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        }
      : null;
  },

  async findAuthByEmail(email: string): Promise<UserAuthRecord | null> {
    const pool = getPool();
    const result = await pool.query<UserRow>(
      `SELECT id, email, display_name AS "displayName", password_hash AS "passwordHash",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users
       WHERE email = $1`,
      [email],
    );
    return result.rows[0] ?? null;
  },

  async create(email: string, displayName: string, passwordHash?: string | null): Promise<User> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<UserRow>(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name AS "displayName", password_hash AS "passwordHash",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, email, displayName, passwordHash ?? null],
    );
    return toUser(result.rows[0]!);
  },

  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    const pool = getPool();
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      id,
    ]);
  },
};
