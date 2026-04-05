import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface McpAuthSessionRow {
  id: string;
  mcpConnectionId: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'expired';
  metadata: Record<string, unknown>;
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpAuthSession extends McpAuthSessionRow {}

export interface McpAuthSessionRepository {
  create(input: {
    mcpConnectionId: string;
    status?: McpAuthSession['status'];
    metadata?: Record<string, unknown>;
    expiresAt: Date;
  }): Promise<McpAuthSession>;
  findById(id: string): Promise<McpAuthSession | null>;
  update(
    id: string,
    input: Partial<{
      status: McpAuthSession['status'];
      metadata: Record<string, unknown>;
      expiresAt: Date;
      completedAt: Date | null;
    }>,
  ): Promise<McpAuthSession | null>;
}

function mapRow(row: McpAuthSessionRow): McpAuthSession {
  return row;
}

export const mcpAuthSessionRepository: McpAuthSessionRepository = {
  async create(input): Promise<McpAuthSession> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<McpAuthSessionRow>(
      `INSERT INTO mcp_auth_sessions (
         id, mcp_connection_id, status, metadata, expires_at
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, mcp_connection_id AS "mcpConnectionId", status, metadata,
                 expires_at AS "expiresAt", completed_at AS "completedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.mcpConnectionId,
        input.status ?? 'pending',
        JSON.stringify(input.metadata ?? {}),
        input.expiresAt,
      ],
    );
    return mapRow(result.rows[0]!);
  },

  async findById(id: string): Promise<McpAuthSession | null> {
    const pool = getPool();
    const result = await pool.query<McpAuthSessionRow>(
      `SELECT id, mcp_connection_id AS "mcpConnectionId", status, metadata,
              expires_at AS "expiresAt", completed_at AS "completedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_auth_sessions
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async update(id, input): Promise<McpAuthSession | null> {
    const pool = getPool();
    const result = await pool.query<McpAuthSessionRow>(
      `UPDATE mcp_auth_sessions
       SET status = COALESCE($2, status),
           metadata = COALESCE($3, metadata),
           expires_at = COALESCE($4, expires_at),
           completed_at = COALESCE($5, completed_at),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, mcp_connection_id AS "mcpConnectionId", status, metadata,
                 expires_at AS "expiresAt", completed_at AS "completedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.status ?? null,
        typeof input.metadata === 'undefined' ? null : JSON.stringify(input.metadata),
        input.expiresAt ?? null,
        typeof input.completedAt === 'undefined' ? null : input.completedAt,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },
};
