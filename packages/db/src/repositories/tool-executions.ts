import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface ToolExecutionRow {
  id: string;
  conversationId: string;
  messageId: string | null;
  toolName: string;
  input: unknown;
  output: unknown | null;
  status: string;
  origin: string;
  approvalId: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface ToolExecution extends ToolExecutionRow {}

export interface ToolExecutionRepository {
  findById(id: string): Promise<ToolExecution | null>;
  listByConversation(conversationId: string, limit?: number, offset?: number): Promise<ToolExecution[]>;
  create(
    conversationId: string,
    messageId: string | null,
    toolName: string,
    input: unknown,
    origin: string,
  ): Promise<ToolExecution>;
  updateStatus(id: string, status: string, output?: unknown): Promise<void>;
  findPendingApproval(conversationId: string): Promise<ToolExecution | null>;
}

export const toolExecutionRepository: ToolExecutionRepository = {
  async findById(id: string): Promise<ToolExecution | null> {
    const pool = getPool();
    const result = await pool.query<ToolExecutionRow>(
      `SELECT id, conversation_id AS "conversationId", message_id AS "messageId", tool_name AS "toolName",
              input, output, status, origin, approval_id AS "approvalId", started_at AS "startedAt",
              completed_at AS "completedAt"
       FROM tool_executions
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByConversation(
    conversationId: string,
    limit = 100,
    offset = 0,
  ): Promise<ToolExecution[]> {
    const pool = getPool();
    const result = await pool.query<ToolExecutionRow>(
      `SELECT id, conversation_id AS "conversationId", message_id AS "messageId", tool_name AS "toolName",
              input, output, status, origin, approval_id AS "approvalId", started_at AS "startedAt",
              completed_at AS "completedAt"
       FROM tool_executions
       WHERE conversation_id = $1
       ORDER BY started_at ASC
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset],
    );
    return result.rows;
  },

  async create(
    conversationId: string,
    messageId: string | null,
    toolName: string,
    input: unknown,
    origin: string,
  ): Promise<ToolExecution> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<ToolExecutionRow>(
      `INSERT INTO tool_executions (id, conversation_id, message_id, tool_name, input, origin)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, conversation_id AS "conversationId", message_id AS "messageId", tool_name AS "toolName",
                 input, output, status, origin, approval_id AS "approvalId", started_at AS "startedAt",
                 completed_at AS "completedAt"`,
      [id, conversationId, messageId, toolName, JSON.stringify(input), origin],
    );
    return result.rows[0]!;
  },

  async updateStatus(id: string, status: string, output?: unknown): Promise<void> {
    const pool = getPool();
    if (typeof output === 'undefined') {
      await pool.query(
        `UPDATE tool_executions
         SET status = $1,
             completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE NULL END
         WHERE id = $2`,
        [status, id],
      );
      return;
    }

    await pool.query(
      `UPDATE tool_executions
       SET status = $1,
           output = $2,
           completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE NULL END
       WHERE id = $3`,
      [status, JSON.stringify(output), id],
    );
  },

  async findPendingApproval(conversationId: string): Promise<ToolExecution | null> {
    const pool = getPool();
    const result = await pool.query<ToolExecutionRow>(
      `SELECT id, conversation_id AS "conversationId", message_id AS "messageId", tool_name AS "toolName",
              input, output, status, origin, approval_id AS "approvalId", started_at AS "startedAt",
              completed_at AS "completedAt"
       FROM tool_executions
       WHERE conversation_id = $1 AND status = 'requires_approval'
       ORDER BY started_at ASC
       LIMIT 1`,
      [conversationId],
    );
    return result.rows[0] ?? null;
  },
};
