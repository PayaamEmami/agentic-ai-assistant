import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface McpConnectionRow {
  id: string;
  userId: string;
  integrationKind: string;
  instanceLabel: string;
  status: 'pending' | 'connected' | 'failed';
  encryptedCredentials: string;
  settings: Record<string, unknown>;
  lastError: string | null;
  isDefaultActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpConnection extends McpConnectionRow {}

export interface McpConnectionRepository {
  findById(id: string): Promise<McpConnection | null>;
  findByIdForUser(id: string, userId: string): Promise<McpConnection | null>;
  findDefaultByUserAndKind(userId: string, integrationKind: string): Promise<McpConnection | null>;
  listByUser(userId: string): Promise<McpConnection[]>;
  listConnectedByUser(userId: string): Promise<McpConnection[]>;
  create(input: {
    userId: string;
    integrationKind: string;
    instanceLabel: string;
    status?: McpConnection['status'];
    encryptedCredentials: string;
    settings?: Record<string, unknown>;
    isDefaultActive?: boolean;
  }): Promise<McpConnection>;
  update(
    id: string,
    input: Partial<{
      instanceLabel: string;
      status: McpConnection['status'];
      encryptedCredentials: string;
      settings: Record<string, unknown>;
      lastError: string | null;
      isDefaultActive: boolean;
    }>,
  ): Promise<McpConnection | null>;
  setDefaultActive(id: string, userId: string): Promise<McpConnection | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

function mapRow(row: McpConnectionRow): McpConnection {
  return row;
}

export const mcpConnectionRepository: McpConnectionRepository = {
  async findById(id: string): Promise<McpConnection | null> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              instance_label AS "instanceLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default_active AS "isDefaultActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_connections
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findByIdForUser(id: string, userId: string): Promise<McpConnection | null> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              instance_label AS "instanceLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default_active AS "isDefaultActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_connections
       WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findDefaultByUserAndKind(userId: string, integrationKind: string): Promise<McpConnection | null> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              instance_label AS "instanceLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default_active AS "isDefaultActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_connections
       WHERE user_id = $1 AND integration_kind = $2 AND is_default_active = TRUE
       LIMIT 1`,
      [userId, integrationKind],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async listByUser(userId: string): Promise<McpConnection[]> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              instance_label AS "instanceLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default_active AS "isDefaultActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_connections
       WHERE user_id = $1
       ORDER BY integration_kind ASC, created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async listConnectedByUser(userId: string): Promise<McpConnection[]> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `SELECT id, user_id AS "userId", integration_kind AS "integrationKind",
              instance_label AS "instanceLabel", status,
              encrypted_credentials AS "encryptedCredentials", settings,
              last_error AS "lastError", is_default_active AS "isDefaultActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_connections
       WHERE user_id = $1 AND status = 'connected'
       ORDER BY integration_kind ASC, is_default_active DESC, created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async create(input): Promise<McpConnection> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<McpConnectionRow>(
      `INSERT INTO mcp_connections (
         id, user_id, integration_kind, instance_label, status, encrypted_credentials, settings,
         is_default_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id AS "userId", integration_kind AS "integrationKind",
                 instance_label AS "instanceLabel", status,
                 encrypted_credentials AS "encryptedCredentials", settings,
                 last_error AS "lastError", is_default_active AS "isDefaultActive",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.userId,
        input.integrationKind,
        input.instanceLabel,
        input.status ?? 'pending',
        input.encryptedCredentials,
        JSON.stringify(input.settings ?? {}),
        input.isDefaultActive ?? false,
      ],
    );
    return mapRow(result.rows[0]!);
  },

  async update(id, input): Promise<McpConnection | null> {
    const pool = getPool();
    const result = await pool.query<McpConnectionRow>(
      `UPDATE mcp_connections
       SET instance_label = COALESCE($2, instance_label),
           status = COALESCE($3, status),
           encrypted_credentials = COALESCE($4, encrypted_credentials),
           settings = COALESCE($5, settings),
           last_error = CASE WHEN $6 THEN $7 ELSE last_error END,
           is_default_active = COALESCE($8, is_default_active),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id AS "userId", integration_kind AS "integrationKind",
                 instance_label AS "instanceLabel", status,
                 encrypted_credentials AS "encryptedCredentials", settings,
                 last_error AS "lastError", is_default_active AS "isDefaultActive",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.instanceLabel ?? null,
        input.status ?? null,
        input.encryptedCredentials ?? null,
        typeof input.settings === 'undefined' ? null : JSON.stringify(input.settings),
        typeof input.lastError !== 'undefined',
        input.lastError ?? null,
        typeof input.isDefaultActive === 'undefined' ? null : input.isDefaultActive,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async setDefaultActive(id: string, userId: string): Promise<McpConnection | null> {
    const pool = getPool();
    const target = await mcpConnectionRepository.findByIdForUser(id, userId);
    if (!target) {
      return null;
    }

    await pool.query(
      `UPDATE mcp_connections
       SET is_default_active = FALSE,
           updated_at = NOW()
       WHERE user_id = $1 AND integration_kind = $2`,
      [userId, target.integrationKind],
    );

    return mcpConnectionRepository.update(id, { isDefaultActive: true });
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM mcp_connections WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ]);
    return (result.rowCount ?? 0) > 0;
  },
};
