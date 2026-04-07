import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface AppSyncRunRow {
  id: string;
  userId: string;
  appCapabilityConfigId: string | null;
  appKind: string;
  capability: string;
  trigger: string;
  status: 'running' | 'completed' | 'failed';
  itemsDiscovered: number;
  itemsQueued: number;
  itemsDeleted: number;
  errorCount: number;
  errorSummary: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface AppSyncRun extends AppSyncRunRow {}

export interface AppSyncRunRepository {
  create(
    userId: string,
    appKind: string,
    capability: string,
    appCapabilityConfigId?: string | null,
    trigger?: string,
  ): Promise<AppSyncRun>;
  complete(
    id: string,
    update: {
      status: AppSyncRun['status'];
      itemsDiscovered: number;
      itemsQueued: number;
      itemsDeleted: number;
      errorCount: number;
      errorSummary?: string | null;
      completedAt?: Date;
    },
  ): Promise<void>;
  listRecentByUserAndAppAndCapability(
    userId: string,
    appKind: string,
    capability: string,
    limit?: number,
  ): Promise<AppSyncRun[]>;
}

const SELECT_FIELDS = `SELECT id,
                              user_id AS "userId",
                              app_capability_config_id AS "appCapabilityConfigId",
                              app_kind AS "appKind",
                              capability,
                              trigger,
                              status,
                              items_discovered AS "itemsDiscovered",
                              items_queued AS "itemsQueued",
                              items_deleted AS "itemsDeleted",
                              error_count AS "errorCount",
                              error_summary AS "errorSummary",
                              started_at AS "startedAt",
                              completed_at AS "completedAt"
                       FROM app_sync_runs`;

export const appSyncRunRepository: AppSyncRunRepository = {
  async create(
    userId: string,
    appKind: string,
    capability: string,
    appCapabilityConfigId: string | null = null,
    trigger = 'manual',
  ): Promise<AppSyncRun> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AppSyncRunRow>(
      `INSERT INTO app_sync_runs (
         id, user_id, app_capability_config_id, app_kind, capability, trigger
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id,
                 user_id AS "userId",
                 app_capability_config_id AS "appCapabilityConfigId",
                 app_kind AS "appKind",
                 capability,
                 trigger,
                 status,
                 items_discovered AS "itemsDiscovered",
                 items_queued AS "itemsQueued",
                 items_deleted AS "itemsDeleted",
                 error_count AS "errorCount",
                 error_summary AS "errorSummary",
                 started_at AS "startedAt",
                 completed_at AS "completedAt"`,
      [id, userId, appCapabilityConfigId, appKind, capability, trigger],
    );
    return result.rows[0]!;
  },

  async complete(
    id: string,
    update: {
      status: AppSyncRun['status'];
      itemsDiscovered: number;
      itemsQueued: number;
      itemsDeleted: number;
      errorCount: number;
      errorSummary?: string | null;
      completedAt?: Date;
    },
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE app_sync_runs
       SET status = $1,
           items_discovered = $2,
           items_queued = $3,
           items_deleted = $4,
           error_count = $5,
           error_summary = $6,
           completed_at = $7
       WHERE id = $8`,
      [
        update.status,
        update.itemsDiscovered,
        update.itemsQueued,
        update.itemsDeleted,
        update.errorCount,
        update.errorSummary ?? null,
        update.completedAt ?? new Date(),
        id,
      ],
    );
  },

  async listRecentByUserAndAppAndCapability(
    userId: string,
    appKind: string,
    capability: string,
    limit = 5,
  ): Promise<AppSyncRun[]> {
    const pool = getPool();
    const result = await pool.query<AppSyncRunRow>(
      `${SELECT_FIELDS}
       WHERE user_id = $1 AND app_kind = $2 AND capability = $3
       ORDER BY started_at DESC
       LIMIT $4`,
      [userId, appKind, capability, limit],
    );
    return result.rows;
  },
};
