import crypto from 'node:crypto';
import { getPool } from '../client.js';

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface AutomationRun {
  id: string;
  scheduleId: string | null;
  userId: string;
  conversationId: string | null;
  status: AutomationRunStatus;
  currentStage: string | null;
  trigger: 'schedule' | 'manual';
  dryRun: boolean;
  boardId: string | null;
  selectedCardId: string | null;
  selectedCardTitle: string | null;
  selectedRepo: string | null;
  rationale: string | null;
  pullRequestUrl: string | null;
  skipReason: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface AutomationRunCreateInput {
  userId: string;
  scheduleId?: string | null;
  conversationId?: string | null;
  trigger?: AutomationRun['trigger'];
  dryRun?: boolean;
  boardId?: string | null;
}

export interface AutomationRunUpdate {
  status?: AutomationRunStatus;
  currentStage?: string | null;
  conversationId?: string | null;
  selectedCardId?: string | null;
  selectedCardTitle?: string | null;
  selectedRepo?: string | null;
  rationale?: string | null;
  pullRequestUrl?: string | null;
  skipReason?: string | null;
  error?: string | null;
  completedAt?: Date | null;
}

export interface AutomationRunRepository {
  create(input: AutomationRunCreateInput): Promise<AutomationRun>;
  findById(id: string): Promise<AutomationRun | null>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<AutomationRun[]>;
  update(
    id: string,
    update: AutomationRunUpdate,
    options?: { requireActive?: boolean },
  ): Promise<AutomationRun | null>;
  /** Refreshes updated_at so a live worker is not failed as stale. */
  touch(id: string): Promise<boolean>;
  findExistingWorkForCard(
    userId: string,
    cardId: string,
    excludeRunId?: string,
  ): Promise<AutomationRun | null>;
  /** Card ids that already have a pull request or an in-flight run. */
  findCardIdsWithExistingWork(userId: string, cardIds: string[]): Promise<string[]>;
  hasActiveRunForSchedule(scheduleId: string): Promise<boolean>;
  /**
   * Marks a queued/running run as failed. Returns the updated row, or null when
   * the run was already terminal so a late worker failure cannot clobber success.
   */
  failIfActive(id: string, error: string): Promise<AutomationRun | null>;
  /** Fails runs that have been queued or running longer than the given limits. */
  failStale(
    now: Date,
    queuedAfterMs: number,
    runningAfterMs: number,
  ): Promise<AutomationRun[]>;
}

const SELECT_FIELDS = `id,
                       schedule_id AS "scheduleId",
                       user_id AS "userId",
                       conversation_id AS "conversationId",
                       status,
                       current_stage AS "currentStage",
                       trigger,
                       dry_run AS "dryRun",
                       board_id AS "boardId",
                       selected_card_id AS "selectedCardId",
                       selected_card_title AS "selectedCardTitle",
                       selected_repo AS "selectedRepo",
                       rationale,
                       pull_request_url AS "pullRequestUrl",
                       skip_reason AS "skipReason",
                       error,
                       started_at AS "startedAt",
                       completed_at AS "completedAt",
                       updated_at AS "updatedAt"`;

const UPDATABLE_COLUMNS: Record<keyof AutomationRunUpdate, string> = {
  status: 'status',
  currentStage: 'current_stage',
  conversationId: 'conversation_id',
  selectedCardId: 'selected_card_id',
  selectedCardTitle: 'selected_card_title',
  selectedRepo: 'selected_repo',
  rationale: 'rationale',
  pullRequestUrl: 'pull_request_url',
  skipReason: 'skip_reason',
  error: 'error',
  completedAt: 'completed_at',
};

const TERMINAL_STATUSES: AutomationRunStatus[] = ['completed', 'skipped', 'failed'];

export const automationRunRepository: AutomationRunRepository = {
  async create(input: AutomationRunCreateInput): Promise<AutomationRun> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AutomationRun>(
      `INSERT INTO automation_runs (
         id, schedule_id, user_id, conversation_id, trigger, dry_run, board_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SELECT_FIELDS}`,
      [
        id,
        input.scheduleId ?? null,
        input.userId,
        input.conversationId ?? null,
        input.trigger ?? 'schedule',
        input.dryRun ?? false,
        input.boardId ?? null,
      ],
    );
    return result.rows[0]!;
  },

  async findById(id: string): Promise<AutomationRun | null> {
    const pool = getPool();
    const result = await pool.query<AutomationRun>(
      `SELECT ${SELECT_FIELDS} FROM automation_runs WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByUser(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<AutomationRun[]> {
    const pool = getPool();
    const result = await pool.query<AutomationRun>(
      `SELECT ${SELECT_FIELDS} FROM automation_runs
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  },

  async update(
    id: string,
    update: AutomationRunUpdate,
    options?: { requireActive?: boolean },
  ): Promise<AutomationRun | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = update[key as keyof AutomationRunUpdate];
      if (value === undefined) {
        continue;
      }

      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
      return options?.requireActive
        ? automationRunRepository.touch(id).then((alive) =>
            alive ? automationRunRepository.findById(id) : null,
          )
        : automationRunRepository.findById(id);
    }

    // A completion timestamp is required by the status/completion CHECK, so fill
    // it in when a caller moves a run to a terminal status without one.
    if (
      update.status &&
      TERMINAL_STATUSES.includes(update.status) &&
      update.completedAt === undefined
    ) {
      values.push(new Date());
      assignments.push(`completed_at = $${values.length}`);
    }

    assignments.push('updated_at = NOW()');

    const pool = getPool();
    values.push(id);
    const activeClause = options?.requireActive
      ? ` AND status IN ('queued', 'running')`
      : '';
    const result = await pool.query<AutomationRun>(
      `UPDATE automation_runs
       SET ${assignments.join(', ')}
       WHERE id = $${values.length}${activeClause}
       RETURNING ${SELECT_FIELDS}`,
      values,
    );
    return result.rows[0] ?? null;
  },

  async touch(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE automation_runs
       SET updated_at = NOW()
       WHERE id = $1 AND status IN ('queued', 'running')
       RETURNING id`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Idempotency guard: skip a card that already has a pull request or is claimed
   * by an in-flight run. `excludeRunId` lets the current run ignore itself after
   * it has written `selected_card_id`.
   */
  async findExistingWorkForCard(
    userId: string,
    cardId: string,
    excludeRunId?: string,
  ): Promise<AutomationRun | null> {
    const pool = getPool();
    const result = await pool.query<AutomationRun>(
      `SELECT ${SELECT_FIELDS} FROM automation_runs
       WHERE user_id = $1
         AND selected_card_id = $2
         AND ($3::uuid IS NULL OR id <> $3)
         AND (
           pull_request_url IS NOT NULL
           OR status IN ('queued', 'running')
         )
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId, cardId, excludeRunId ?? null],
    );
    return result.rows[0] ?? null;
  },

  async findCardIdsWithExistingWork(userId: string, cardIds: string[]): Promise<string[]> {
    if (cardIds.length === 0) {
      return [];
    }

    const pool = getPool();
    const result = await pool.query<{ selectedCardId: string }>(
      `SELECT DISTINCT selected_card_id AS "selectedCardId" FROM automation_runs
       WHERE user_id = $1
         AND selected_card_id = ANY($2::text[])
         AND (
           pull_request_url IS NOT NULL
           OR status IN ('queued', 'running')
         )`,
      [userId, cardIds],
    );
    return result.rows.map((row) => row.selectedCardId);
  },

  async hasActiveRunForSchedule(scheduleId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT 1 FROM automation_runs
       WHERE schedule_id = $1 AND status IN ('queued', 'running')
       LIMIT 1`,
      [scheduleId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async failIfActive(id: string, error: string): Promise<AutomationRun | null> {
    const pool = getPool();
    const result = await pool.query<AutomationRun>(
      `UPDATE automation_runs
       SET status = 'failed',
           current_stage = NULL,
           error = $2,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND status IN ('queued', 'running')
       RETURNING ${SELECT_FIELDS}`,
      [id, error],
    );
    return result.rows[0] ?? null;
  },

  async failStale(
    now: Date,
    queuedAfterMs: number,
    runningAfterMs: number,
  ): Promise<AutomationRun[]> {
    const pool = getPool();
    const result = await pool.query<AutomationRun>(
      `UPDATE automation_runs
       SET status = 'failed',
           current_stage = NULL,
           error = 'Run did not finish before it timed out. The worker may have crashed.',
           completed_at = NOW(),
           updated_at = NOW()
       WHERE (status = 'queued' AND started_at < $1::timestamptz - ($2::double precision * interval '1 millisecond'))
          OR (status = 'running' AND updated_at < $1::timestamptz - ($3::double precision * interval '1 millisecond'))
       RETURNING ${SELECT_FIELDS}`,
      [now, queuedAfterMs, runningAfterMs],
    );
    return result.rows;
  },
};
