import crypto from 'node:crypto';
import { getPool } from '../client.js';

export type CodingRunStatus = 'running' | 'finished' | 'error';

export interface CodingRun {
  id: string;
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  providerId: string;
  externalId: string;
  repo: string;
  status: CodingRunStatus;
  summary: string | null;
  branch: string | null;
  pullRequestUrl: string | null;
  correlationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CodingRunCreateInput {
  userId: string;
  conversationId: string;
  toolExecutionId: string;
  providerId: string;
  externalId: string;
  repo: string;
  correlationId: string;
}

export interface CodingRunSettlement {
  status: Exclude<CodingRunStatus, 'running'>;
  summary: string;
  branch: string | null;
  pullRequestUrl: string | null;
}

const SELECT_COLUMNS = `id, user_id AS "userId", conversation_id AS "conversationId",
  tool_execution_id AS "toolExecutionId", provider_id AS "providerId",
  external_id AS "externalId", repo, status, summary, branch,
  pull_request_url AS "pullRequestUrl", correlation_id AS "correlationId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export interface CodingRunRepository {
  create(input: CodingRunCreateInput): Promise<CodingRun>;
  listRunning(): Promise<CodingRun[]>;
  /**
   * First terminal write wins. A second call returns null so a poller retry
   * does not continue the chat again.
   */
  settleIfRunning(id: string, settlement: CodingRunSettlement): Promise<CodingRun | null>;
}

export const codingRunRepository: CodingRunRepository = {
  async create(input: CodingRunCreateInput): Promise<CodingRun> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<CodingRun>(
      `INSERT INTO coding_runs (
         id, user_id, conversation_id, tool_execution_id, provider_id, external_id, repo, correlation_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        input.userId,
        input.conversationId,
        input.toolExecutionId,
        input.providerId,
        input.externalId,
        input.repo,
        input.correlationId,
      ],
    );
    return result.rows[0]!;
  },

  async listRunning(): Promise<CodingRun[]> {
    const pool = getPool();
    const result = await pool.query<CodingRun>(
      `SELECT ${SELECT_COLUMNS}
       FROM coding_runs
       WHERE status = 'running'
       ORDER BY created_at ASC, id ASC`,
    );
    return result.rows;
  },

  async settleIfRunning(id: string, settlement: CodingRunSettlement): Promise<CodingRun | null> {
    const pool = getPool();
    const result = await pool.query<CodingRun>(
      `UPDATE coding_runs
       SET status = $2,
           summary = $3,
           branch = $4,
           pull_request_url = $5,
           updated_at = NOW()
       WHERE id = $1 AND status = 'running'
       RETURNING ${SELECT_COLUMNS}`,
      [id, settlement.status, settlement.summary, settlement.branch, settlement.pullRequestUrl],
    );
    return result.rows[0] ?? null;
  },
};
