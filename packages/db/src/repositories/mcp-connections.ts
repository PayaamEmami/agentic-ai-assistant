import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface McpProfileRow {
  id: string;
  userId: string;
  integrationKind: string;
  profileLabel: string;
  status: 'pending' | 'connected' | 'failed';
  encryptedCredentials: string;
  settings: Record<string, unknown>;
  lastError: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpProfile extends McpProfileRow {}

export interface McpProfileRepository {
  findById(id: string): Promise<McpProfile | null>;
  findByIdForUser(id: string, userId: string): Promise<McpProfile | null>;
  findDefaultByUserAndKind(userId: string, integrationKind: string): Promise<McpProfile | null>;
  listByUser(userId: string): Promise<McpProfile[]>;
  listConnectedByUser(userId: string): Promise<McpProfile[]>;
  create(input: {
    userId: string;
    integrationKind: string;
    profileLabel: string;
    status?: McpProfile['status'];
    encryptedCredentials: string;
    settings?: Record<string, unknown>;
    isDefault?: boolean;
  }): Promise<McpProfile>;
  update(
    id: string,
    input: Partial<{
      profileLabel: string;
      status: McpProfile['status'];
      encryptedCredentials: string;
      settings: Record<string, unknown>;
      lastError: string | null;
      isDefault: boolean;
    }>,
  ): Promise<McpProfile | null>;
  setDefault(id: string, userId: string): Promise<McpProfile | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

function mapRow(row: McpProfileRow): McpProfile {
  return row;
}

export const mcpProfileRepository: McpProfileRepository = {
  async findById(id: string): Promise<McpProfile | null> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              profile_label AS "profileLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_profiles
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findByIdForUser(id: string, userId: string): Promise<McpProfile | null> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              profile_label AS "profileLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_profiles
       WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findDefaultByUserAndKind(
    userId: string,
    integrationKind: string,
  ): Promise<McpProfile | null> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              profile_label AS "profileLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_profiles
       WHERE user_id = $1 AND integration_kind = $2 AND is_default = TRUE
       LIMIT 1`,
      [userId, integrationKind],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async listByUser(userId: string): Promise<McpProfile[]> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              profile_label AS "profileLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_profiles
       WHERE user_id = $1
       ORDER BY integration_kind ASC, created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async listConnectedByUser(userId: string): Promise<McpProfile[]> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              profile_label AS "profileLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default AS "isDefault",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_profiles
       WHERE user_id = $1 AND status = 'connected'
       ORDER BY integration_kind ASC, is_default DESC, created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async create(input): Promise<McpProfile> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<McpProfileRow>(
      `INSERT INTO mcp_profiles (
         id, user_id, integration_kind, profile_label, status, encrypted_credentials, settings,
         is_default
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id AS "userId", integration_kind AS "integrationKind",
                 profile_label AS "profileLabel", status,
                 encrypted_credentials AS "encryptedCredentials", settings,
                 last_error AS "lastError", is_default AS "isDefault",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.userId,
        input.integrationKind,
        input.profileLabel,
        input.status ?? 'pending',
        input.encryptedCredentials,
        JSON.stringify(input.settings ?? {}),
        input.isDefault ?? false,
      ],
    );
    return mapRow(result.rows[0]!);
  },

  async update(id, input): Promise<McpProfile | null> {
    const pool = getPool();
    const result = await pool.query<McpProfileRow>(
      `UPDATE mcp_profiles
       SET profile_label = COALESCE($2, profile_label),
           status = COALESCE($3, status),
           encrypted_credentials = COALESCE($4, encrypted_credentials),
           settings = COALESCE($5, settings),
           last_error = CASE WHEN $6 THEN $7 ELSE last_error END,
           is_default = COALESCE($8, is_default),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id AS "userId", integration_kind AS "integrationKind",
                 profile_label AS "profileLabel", status,
                 encrypted_credentials AS "encryptedCredentials", settings,
                 last_error AS "lastError", is_default AS "isDefault",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.profileLabel ?? null,
        input.status ?? null,
        input.encryptedCredentials ?? null,
        typeof input.settings === 'undefined' ? null : JSON.stringify(input.settings),
        typeof input.lastError !== 'undefined',
        input.lastError ?? null,
        typeof input.isDefault === 'undefined' ? null : input.isDefault,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async setDefault(id: string, userId: string): Promise<McpProfile | null> {
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const targetResult = await client.query<McpProfileRow>(
        `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
                profile_label AS "profileLabel", status,
                encrypted_credentials AS "encryptedCredentials", settings,
                last_error AS "lastError", is_default AS "isDefault",
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM mcp_profiles
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [id, userId],
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE mcp_profiles
         SET is_default = FALSE,
             updated_at = NOW()
         WHERE user_id = $1 AND integration_kind = $2`,
        [userId, target.integrationKind],
      );

      const updated = await client.query<McpProfileRow>(
        `UPDATE mcp_profiles
         SET is_default = TRUE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, user_id AS "userId", integration_kind AS "integrationKind",
                   profile_label AS "profileLabel", status,
                   encrypted_credentials AS "encryptedCredentials", settings,
                   last_error AS "lastError", is_default AS "isDefault",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id],
      );
      await client.query('COMMIT');
      return updated.rows[0] ? mapRow(updated.rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM mcp_profiles WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  },
};
