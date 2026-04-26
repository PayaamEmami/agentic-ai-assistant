import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface ApprovalRow {
  id: string;
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  description: string;
  status: string;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface Approval extends ApprovalRow {}

export interface ApprovalRepository {
  findById(id: string): Promise<Approval | null>;
  listPendingByUser(userId: string): Promise<Approval[]>;
  create(
    userId: string,
    conversationId: string,
    toolExecutionId: string,
    description: string,
  ): Promise<Approval>;
  decide(id: string, status: string): Promise<void>;
}

export const approvalRepository: ApprovalRepository = {
  async findById(id: string): Promise<Approval | null> {
    const pool = getPool();
    const result = await pool.query<ApprovalRow>(
      `SELECT id, user_id AS "userId", conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", description, status,
              decided_at AS "decidedAt", created_at AS "createdAt"
       FROM approvals
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listPendingByUser(userId: string): Promise<Approval[]> {
    const pool = getPool();
    const result = await pool.query<ApprovalRow>(
      `SELECT id, user_id AS "userId", conversation_id AS "conversationId",
              tool_execution_id AS "toolExecutionId", description, status,
              decided_at AS "decidedAt", created_at AS "createdAt"
       FROM approvals
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows;
  },

  async create(
    userId: string,
    conversationId: string,
    toolExecutionId: string,
    description: string,
  ): Promise<Approval> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<ApprovalRow>(
      `INSERT INTO approvals (id, user_id, conversation_id, tool_execution_id, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id AS "userId", conversation_id AS "conversationId",
                 tool_execution_id AS "toolExecutionId", description, status,
                 decided_at AS "decidedAt", created_at AS "createdAt"`,
      [id, userId, conversationId, toolExecutionId, description],
    );
    return result.rows[0]!;
  },

  async decide(id: string, status: string): Promise<void> {
    const pool = getPool();
    await pool.query('UPDATE approvals SET status = $1, decided_at = NOW() WHERE id = $2', [
      status,
      id,
    ]);
  },
};
