import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface BrowserSessionRow {
  id: string;
  userId: string;
  mcpProfileId: string;
  messageId: string | null;
  purpose: 'sign_in' | 'manual' | 'handoff';
  status: 'pending' | 'active' | 'completed' | 'cancelled' | 'expired' | 'failed' | 'crashed';
  conversationId: string | null;
  toolExecutionId: string | null;
  selectedPageId: string | null;
  metadata: Record<string, unknown>;
  ownerApiInstanceId: string | null;
  ownerApiInstanceUrl: string | null;
  lastClientSeenAt: Date | null;
  lastFrameAt: Date | null;
  expiresAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpBrowserSession extends BrowserSessionRow {}

export interface McpBrowserSessionRepository {
  create(input: {
    userId: string;
    mcpProfileId: string;
    messageId?: string | null;
    purpose: McpBrowserSession['purpose'];
    conversationId?: string | null;
    toolExecutionId?: string | null;
    selectedPageId?: string | null;
    status?: McpBrowserSession['status'];
    metadata?: Record<string, unknown>;
    ownerApiInstanceId?: string | null;
    ownerApiInstanceUrl?: string | null;
    lastClientSeenAt?: Date | null;
    lastFrameAt?: Date | null;
    expiresAt: Date;
    endedAt?: Date | null;
  }): Promise<McpBrowserSession>;
  findById(id: string): Promise<McpBrowserSession | null>;
  findActiveByProfile(mcpProfileId: string): Promise<McpBrowserSession | null>;
  listByUser(
    userId: string,
    input?: {
      conversationId?: string;
      includeEnded?: boolean;
      limit?: number;
    },
  ): Promise<McpBrowserSession[]>;
  listActiveByUser(userId: string): Promise<McpBrowserSession[]>;
  markActiveAsCrashed(ownerApiInstanceId?: string | null): Promise<number>;
  update(
    id: string,
    input: Partial<{
      messageId: string | null;
      purpose: McpBrowserSession['purpose'];
      status: McpBrowserSession['status'];
      conversationId: string | null;
      toolExecutionId: string | null;
      selectedPageId: string | null;
      metadata: Record<string, unknown>;
      ownerApiInstanceId: string | null;
      ownerApiInstanceUrl: string | null;
      lastClientSeenAt: Date | null;
      lastFrameAt: Date | null;
      expiresAt: Date;
      endedAt: Date | null;
    }>,
  ): Promise<McpBrowserSession | null>;
}

function mapRow(row: BrowserSessionRow): McpBrowserSession {
  return row;
}

export const mcpBrowserSessionRepository: McpBrowserSessionRepository = {
  async create(input): Promise<McpBrowserSession> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<BrowserSessionRow>(
      `INSERT INTO browser_sessions (
         id, user_id, mcp_profile_id, message_id, purpose, status, conversation_id, tool_execution_id,
         selected_page_id, metadata, owner_api_instance_id, owner_api_instance_url,
         last_client_seen_at, last_frame_at, expires_at, ended_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id, user_id AS "userId", mcp_profile_id AS "mcpProfileId",
                 message_id AS "messageId",
                 purpose, status, conversation_id AS "conversationId",
                 tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
                 metadata, owner_api_instance_id AS "ownerApiInstanceId",
                 owner_api_instance_url AS "ownerApiInstanceUrl",
                 last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
                 expires_at AS "expiresAt", ended_at AS "endedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        input.userId,
        input.mcpProfileId,
        input.messageId ?? null,
        input.purpose,
        input.status ?? 'pending',
        input.conversationId ?? null,
        input.toolExecutionId ?? null,
        input.selectedPageId ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.ownerApiInstanceId ?? null,
        input.ownerApiInstanceUrl ?? null,
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
    const result = await pool.query<BrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_profile_id AS "mcpProfileId",
              message_id AS "messageId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, owner_api_instance_id AS "ownerApiInstanceId",
              owner_api_instance_url AS "ownerApiInstanceUrl",
              last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM browser_sessions
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async findActiveByProfile(mcpProfileId): Promise<McpBrowserSession | null> {
    const pool = getPool();
    const result = await pool.query<BrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_profile_id AS "mcpProfileId",
              message_id AS "messageId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, owner_api_instance_id AS "ownerApiInstanceId",
              owner_api_instance_url AS "ownerApiInstanceUrl",
              last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM browser_sessions
       WHERE mcp_profile_id = $1 AND status IN ('pending', 'active')
       ORDER BY created_at DESC
       LIMIT 1`,
      [mcpProfileId],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  async listByUser(userId, input = {}): Promise<McpBrowserSession[]> {
    const pool = getPool();
    const limit = input.limit ?? 20;
    const result = await pool.query<BrowserSessionRow>(
      `SELECT id, user_id AS "userId", mcp_profile_id AS "mcpProfileId",
              message_id AS "messageId",
              purpose, status, conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
              metadata, owner_api_instance_id AS "ownerApiInstanceId",
              owner_api_instance_url AS "ownerApiInstanceUrl",
              last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
              expires_at AS "expiresAt", ended_at AS "endedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM browser_sessions
       WHERE user_id = $1
         AND ($2::uuid IS NULL OR conversation_id = $2)
         AND ($3::boolean OR status IN ('pending', 'active'))
       ORDER BY updated_at DESC, created_at DESC
       LIMIT $4`,
      [userId, input.conversationId ?? null, input.includeEnded ?? false, limit],
    );
    return result.rows.map(mapRow);
  },

  async listActiveByUser(userId): Promise<McpBrowserSession[]> {
    return mcpBrowserSessionRepository.listByUser(userId, { includeEnded: false, limit: 20 });
  },

  async markActiveAsCrashed(ownerApiInstanceId = null): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE browser_sessions
       SET status = 'crashed',
           ended_at = NOW(),
           updated_at = NOW()
       WHERE status IN ('pending', 'active')
         AND ($1::text IS NULL OR owner_api_instance_id = $1 OR owner_api_instance_id IS NULL)`,
      [ownerApiInstanceId],
    );
    return result.rowCount ?? 0;
  },

  async update(id, input): Promise<McpBrowserSession | null> {
    const pool = getPool();
    const result = await pool.query<BrowserSessionRow>(
      `UPDATE browser_sessions
       SET message_id = CASE WHEN $2 THEN $3 ELSE message_id END,
           purpose = COALESCE($4, purpose),
           status = COALESCE($5, status),
           conversation_id = CASE WHEN $6 THEN $7 ELSE conversation_id END,
           tool_execution_id = CASE WHEN $8 THEN $9 ELSE tool_execution_id END,
           selected_page_id = CASE WHEN $10 THEN $11 ELSE selected_page_id END,
           metadata = COALESCE($12, metadata),
           owner_api_instance_id = CASE WHEN $13 THEN $14 ELSE owner_api_instance_id END,
           owner_api_instance_url = CASE WHEN $15 THEN $16 ELSE owner_api_instance_url END,
           last_client_seen_at = CASE WHEN $17 THEN $18 ELSE last_client_seen_at END,
           last_frame_at = CASE WHEN $19 THEN $20 ELSE last_frame_at END,
           expires_at = COALESCE($21, expires_at),
           ended_at = CASE WHEN $22 THEN $23 ELSE ended_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, user_id AS "userId", mcp_profile_id AS "mcpProfileId",
                 message_id AS "messageId",
                 purpose, status, conversation_id AS "conversationId",
                 tool_execution_id AS "toolExecutionId", selected_page_id AS "selectedPageId",
                 metadata, owner_api_instance_id AS "ownerApiInstanceId",
                 owner_api_instance_url AS "ownerApiInstanceUrl",
                 last_client_seen_at AS "lastClientSeenAt", last_frame_at AS "lastFrameAt",
                 expires_at AS "expiresAt", ended_at AS "endedAt",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        id,
        typeof input.messageId !== 'undefined',
        input.messageId ?? null,
        input.purpose ?? null,
        input.status ?? null,
        typeof input.conversationId !== 'undefined',
        input.conversationId ?? null,
        typeof input.toolExecutionId !== 'undefined',
        input.toolExecutionId ?? null,
        typeof input.selectedPageId !== 'undefined',
        input.selectedPageId ?? null,
        typeof input.metadata === 'undefined' ? null : JSON.stringify(input.metadata),
        typeof input.ownerApiInstanceId !== 'undefined',
        input.ownerApiInstanceId ?? null,
        typeof input.ownerApiInstanceUrl !== 'undefined',
        input.ownerApiInstanceUrl ?? null,
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
