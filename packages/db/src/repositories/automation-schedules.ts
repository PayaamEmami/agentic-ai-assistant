import crypto from 'node:crypto';
import { getPool } from '../client.js';

export interface AutomationSchedule {
  id: string;
  userId: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  boardId: string;
  sourceListId: string | null;
  /** null means every repository the GitHub connection can reach. */
  repoAllowlist: string[] | null;
  dryRun: boolean;
  maxRunsPerDay: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationScheduleInput {
  name: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  boardId: string;
  sourceListId?: string | null;
  repoAllowlist?: string[] | null;
  dryRun?: boolean;
  maxRunsPerDay?: number;
  nextRunAt?: Date | null;
}

export type AutomationScheduleUpdate = Partial<AutomationScheduleInput>;

export interface AutomationScheduleRepository {
  create(userId: string, input: AutomationScheduleInput): Promise<AutomationSchedule>;
  findById(id: string): Promise<AutomationSchedule | null>;
  listByUser(userId: string): Promise<AutomationSchedule[]>;
  listDue(now: Date, limit?: number): Promise<AutomationSchedule[]>;
  update(
    id: string,
    userId: string,
    update: AutomationScheduleUpdate,
  ): Promise<AutomationSchedule | null>;
  /**
   * Atomically claims a due schedule so two scheduler replicas cannot enqueue
   * the same fire. Returns false when another replica already claimed it.
   */
  claimDue(id: string, lastRunAt: Date, nextRunAt: Date | null): Promise<boolean>;
  delete(id: string, userId: string): Promise<boolean>;
  countRunsToday(id: string, since: Date): Promise<number>;
}

const SELECT_FIELDS = `id,
                       user_id AS "userId",
                       name,
                       cron,
                       timezone,
                       enabled,
                       board_id AS "boardId",
                       source_list_id AS "sourceListId",
                       repo_allowlist AS "repoAllowlist",
                       dry_run AS "dryRun",
                       max_runs_per_day AS "maxRunsPerDay",
                       last_run_at AS "lastRunAt",
                       next_run_at AS "nextRunAt",
                       created_at AS "createdAt",
                       updated_at AS "updatedAt"`;

const UPDATABLE_COLUMNS: Record<keyof AutomationScheduleInput, string> = {
  name: 'name',
  cron: 'cron',
  timezone: 'timezone',
  enabled: 'enabled',
  boardId: 'board_id',
  sourceListId: 'source_list_id',
  repoAllowlist: 'repo_allowlist',
  dryRun: 'dry_run',
  maxRunsPerDay: 'max_runs_per_day',
  nextRunAt: 'next_run_at',
};

export const automationScheduleRepository: AutomationScheduleRepository = {
  async create(
    userId: string,
    input: AutomationScheduleInput,
  ): Promise<AutomationSchedule> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AutomationSchedule>(
      `INSERT INTO automation_schedules (
         id, user_id, name, cron, timezone, enabled, board_id, source_list_id,
         repo_allowlist, dry_run, max_runs_per_day, next_run_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${SELECT_FIELDS}`,
      [
        id,
        userId,
        input.name,
        input.cron,
        input.timezone ?? 'UTC',
        input.enabled ?? true,
        input.boardId,
        input.sourceListId ?? null,
        input.repoAllowlist ? JSON.stringify(input.repoAllowlist) : null,
        input.dryRun ?? true,
        input.maxRunsPerDay ?? 1,
        input.nextRunAt ?? null,
      ],
    );
    return result.rows[0]!;
  },

  async findById(id: string): Promise<AutomationSchedule | null> {
    const pool = getPool();
    const result = await pool.query<AutomationSchedule>(
      `SELECT ${SELECT_FIELDS} FROM automation_schedules WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByUser(userId: string): Promise<AutomationSchedule[]> {
    const pool = getPool();
    const result = await pool.query<AutomationSchedule>(
      `SELECT ${SELECT_FIELDS} FROM automation_schedules
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows;
  },

  /** Enabled schedules whose next_run_at has passed. */
  async listDue(now: Date, limit = 25): Promise<AutomationSchedule[]> {
    const pool = getPool();
    const result = await pool.query<AutomationSchedule>(
      `SELECT ${SELECT_FIELDS} FROM automation_schedules
       WHERE enabled AND next_run_at IS NOT NULL AND next_run_at <= $1
       ORDER BY next_run_at ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows;
  },

  async update(
    id: string,
    userId: string,
    update: AutomationScheduleUpdate,
  ): Promise<AutomationSchedule | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = update[key as keyof AutomationScheduleUpdate];
      if (value === undefined) {
        continue;
      }

      values.push(key === 'repoAllowlist' && value ? JSON.stringify(value) : value);
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length === 0) {
      return automationScheduleRepository.findById(id);
    }

    const pool = getPool();
    values.push(id, userId);
    const result = await pool.query<AutomationSchedule>(
      `UPDATE automation_schedules
       SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${SELECT_FIELDS}`,
      values,
    );
    return result.rows[0] ?? null;
  },

  async claimDue(id: string, lastRunAt: Date, nextRunAt: Date | null): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `UPDATE automation_schedules
       SET last_run_at = $1, next_run_at = $2, updated_at = NOW()
       WHERE id = $3
         AND enabled
         AND next_run_at IS NOT NULL
         AND next_run_at <= $1
       RETURNING id`,
      [lastRunAt, nextRunAt, id],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM automation_schedules s
       WHERE s.id = $1
         AND s.user_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM automation_runs r
           WHERE r.schedule_id = s.id AND r.status IN ('queued', 'running')
         )`,
      [id, userId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async countRunsToday(id: string, since: Date): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM automation_runs
       WHERE schedule_id = $1
         AND started_at >= $2
         AND status IN ('completed', 'skipped')`,
      [id, since],
    );
    return Number(result.rows[0]?.count ?? '0');
  },
};
