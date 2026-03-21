import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface ConnectorSyncRunRow {
  id: string;
  userId: string;
  connectorConfigId: string | null;
  connectorKind: string;
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

export interface ConnectorSyncRun extends ConnectorSyncRunRow {}

export interface ConnectorSyncRunRepository {
  create(
    userId: string,
    connectorKind: string,
    connectorConfigId?: string | null,
    trigger?: string,
  ): Promise<ConnectorSyncRun>;
  complete(
    id: string,
    update: {
      status: ConnectorSyncRun['status'];
      itemsDiscovered: number;
      itemsQueued: number;
      itemsDeleted: number;
      errorCount: number;
      errorSummary?: string | null;
      completedAt?: Date;
    },
  ): Promise<void>;
  listRecentByUserAndKind(
    userId: string,
    connectorKind: string,
    limit?: number,
  ): Promise<ConnectorSyncRun[]>;
}

const SELECT_FIELDS = `SELECT id,
                              user_id AS "userId",
                              connector_config_id AS "connectorConfigId",
                              connector_kind AS "connectorKind",
                              trigger,
                              status,
                              items_discovered AS "itemsDiscovered",
                              items_queued AS "itemsQueued",
                              items_deleted AS "itemsDeleted",
                              error_count AS "errorCount",
                              error_summary AS "errorSummary",
                              started_at AS "startedAt",
                              completed_at AS "completedAt"
                       FROM connector_sync_runs`;

export const connectorSyncRunRepository: ConnectorSyncRunRepository = {
  async create(
    userId: string,
    connectorKind: string,
    connectorConfigId: string | null = null,
    trigger = 'manual',
  ): Promise<ConnectorSyncRun> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<ConnectorSyncRunRow>(
      `INSERT INTO connector_sync_runs (
         id, user_id, connector_config_id, connector_kind, trigger
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id,
                 user_id AS "userId",
                 connector_config_id AS "connectorConfigId",
                 connector_kind AS "connectorKind",
                 trigger,
                 status,
                 items_discovered AS "itemsDiscovered",
                 items_queued AS "itemsQueued",
                 items_deleted AS "itemsDeleted",
                 error_count AS "errorCount",
                 error_summary AS "errorSummary",
                 started_at AS "startedAt",
                 completed_at AS "completedAt"`,
      [id, userId, connectorConfigId, connectorKind, trigger],
    );
    return result.rows[0]!;
  },

  async complete(
    id: string,
    update: {
      status: ConnectorSyncRun['status'];
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
      `UPDATE connector_sync_runs
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

  async listRecentByUserAndKind(
    userId: string,
    connectorKind: string,
    limit = 5,
  ): Promise<ConnectorSyncRun[]> {
    const pool = getPool();
    const result = await pool.query<ConnectorSyncRunRow>(
      `${SELECT_FIELDS}
       WHERE user_id = $1 AND connector_kind = $2
       ORDER BY started_at DESC
       LIMIT $3`,
      [userId, connectorKind, limit],
    );
    return result.rows;
  },
};
