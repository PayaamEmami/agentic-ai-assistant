import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface McpBrowserSessionRow {
  id: string;
  userId: string;
  mcpConnectionId: string;
  purpose: 'auth' | 'manual' | 'tool_takeover';
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'expired' | 'failed' | 'crashed';
  conversationId: string | null;
  toolExecutionId: string | null;
  selectedPageId: string | null;
  metadata: Record<string, unknown>;
  lastClientSeenAt: Date | null;
  lastFrameAt: Date | null;
  expiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpBrowserSession extends McpBrowserSessionRow {}

export interface McpBrowserSessionRepository {
  create(input: {
    userId: string;
    mcpConnectionId: string;
    purpose: McpBrowserSession['purpose'];
    conversationId?: string | null;
    toolExecutionId?: string | null;
    selectedPageId?: string | null;
    status?: McpBrowserSession['status'];
    metadata?: Record<string, unknown>;
    lastClientSeenAt?: Date | null;
    lastFrameAt?: Date | null;
    expiresAt: Date;
    endedAt?: Date | null;
  }): Promise<McpBrowserSession>;
  findById(id: string): Promise<McpBrowserSession | null>;
  findActiveByConnection(mcpConnectionId: string): Promise<McpBrowserSession | null>;
  listByUser(
    userId: string,
    input?: {
      conversationId?: string;
      includeEnded?: boolean;
      limit?: number;
    },
  ): Promise<McpBrowserSession[]>;
  listActiveByUser(userId: string): Promise<McpBrowserSession[]>;
  markActiveAsCrashed(): Promise<number>;
  update(
    id: string,
    input: Partial<{
      purpose: McpBrowserSession['purpose'];
      status: McpBrowserSession['status'];
      conversationId: string | null;
      toolExecutionId: string | null;
      selectedPageId: string | null;
      metadata: Record<string, unknown>;
      lastClientSeenAt: Date | null;
      lastFrameAt: Date | null;
      expiresAt: Date;
      endedAt: Date | null;
    }>,
  ): Promise<McpBrowserSession | null>;
}

function mapRow(row: McpBrowserSessionRow): McpBrowserSession {
  return row;
}

export const mcpBrowserSessionRepository: McpBrowserSessionRepository = {
  async create(input): Promise<McpBrowserSession> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<McpBrowserSessionRow>(
      `INSERT INTO mcp_browser_sessions (
         id, user_id, mcp_connection_id, purpose, status, conversation_id, tool_execution_id,
         selected_page_id, metadata, last_client_seen_at, last_frame_at, expires_at, ended_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, user_id AS "userId", mcp_connection_id AS "mcpConnectionId",
                 purpose, status, conversation_id AS "conversationId",
                 tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
                 metadata, last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
                 expires_at AS "expiresAt", ended_at AS "endedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.userId,
        input.mcpConnectionId,
        input.purpose,
        input.status ?? 'pending',
        input.conversationId ?? null,
        input.toolExecutionId ?? null,
        input.selectedPageId ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.lastClientSeenAt ?? null,
        input.lastFrameAt ?? null,
        input.expiresAt,
        input.endedAt ?? null,
      ],
    );
    return mapRow(result.rows[0]!);
  },

  async findById(id): Promise<McpBrowserSession | null> {
    const pool = getPool();
    const result = await pool.query<McpBrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_connection_id AS "mcpConnectionId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_browser_sessions
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findActiveByConnection(mcpConnectionId): Promise<McpBrowserSession | null> {
    const pool = getPool();
    const result = await pool.query<McpBrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_connection_id AS "mcpConnectionId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_browser_sessions
       WHERE mcp_connection_id = $1 AND status IN ('pending', 'active')
       ORDER BY created_at DESC
       LIMIT 1`,
      [mcpConnectionId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async listByUser(
    userId,
    input = {},
  ): Promise<McpBrowserSession[]> {
    const pool = getPool();
    const limit = input.limit ?? 20;
    const result = await pool.query<McpBrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_connection_id AS "mcpConnectionId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM mcp_browser_sessions
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR conversation_id = $2)
         AND ($3::boolean OR status IN ('pending', 'active'))
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $4`,
      [
        userId,
        input.conversationId ?? null,
        input.includeEnded ?? false,
        limit,
      ],
    );
    return result.rows.map(mapRow);
  },

  async listActiveByUser(userId): Promise<McpBrowserSession[]> {
    return mcpBrowserSessionRepository.listByUser(userId, { includeEnded: false, limit: 20 });
  },

  async markActiveAsCrashed(): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE mcp_browser_sessions
       SET status = 'crashed',
           ended_at = NOW(),
           updated_at = NOW()
       WHERE status IN ('pending', 'active')`,
    );
    return result.rowCount ?? 0;
  },

  async update(id, input): Promise<McpBrowserSession | null> {
    const pool = getPool();
    const result = await pool.query<McpBrowserSessionRow>(
      `UPDATE mcp_browser_sessions
       SET purpose = COALESCE($2, purpose),
           status = COALESCE($3, status),
           conversation_id = CASE WHEN $4 THEN $5 ELSE conversation_id END,
           tool_execution_id = CASE WHEN $6 THEN $7 ELSE tool_execution_id END,
           selected_page_id = CASE WHEN $8 THEN $9 ELSE selected_page_id END,
           metadata = COALESCE($10, metadata),
           last_client_seen_at = CASE WHEN $11 THEN $12 ELSE last_client_seen_at END,
           last_frame_at = CASE WHEN $13 THEN $14 ELSE last_frame_at END,
           expires_at = COALESCE($15, expires_at),
           ended_at = CASE WHEN $16 THEN $17 ELSE ended_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id AS "userId", mcp_connection_id AS "mcpConnectionId",
                 purpose, status, conversation_id AS "conversationId",
                 tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
                 metadata, last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
                 expires_at AS "expiresAt", ended_at AS "endedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.purpose ?? null,
        input.status ?? null,
        typeof input.conversationId !== 'undefined',
        input.conversationId ?? null,
        typeof input.toolExecutionId !== 'undefined',
        input.toolExecutionId ?? null,
        typeof input.selectedPageId !== 'undefined',
        input.selectedPageId ?? null,
        typeof input.metadata === 'undefined' ? null : JSON.stringify(input.metadata),
        typeof input.lastClientSeenAt !== 'undefined',
        input.lastClientSeenAt ?? null,
        typeof input.lastFrameAt !== 'undefined',
        input.lastFrameAt ?? null,
        input.expiresAt ?? null,
        typeof input.endedAt !== 'undefined',
        input.endedAt ?? null,
      ],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },
};
