import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface AppCapabilityConfigRow {
  id: string;
  userId: string;
  appKind: string;
  capability: string;
  status: 'pending' | 'connected' | 'failed';
  encryptedCredentials: string;
  settings: Record<string, unknown>;
  lastSyncCursor: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppCapabilityConfig extends AppCapabilityConfigRow {}

export interface AppCapabilityConfigRepository {
  findById(id: string): Promise<AppCapabilityConfig | null>;
  findByUserAppAndCapability(
    userId: string,
    appKind: string,
    capability: string,
  ): Promise<AppCapabilityConfig | null>;
  listByUser(userId: string): Promise<AppCapabilityConfig[]>;
  listByUserAndApp(userId: string, appKind: string): Promise<AppCapabilityConfig[]>;
  listConnected(): Promise<AppCapabilityConfig[]>;
  upsert(
    userId: string,
    appKind: string,
    capability: string,
    status: AppCapabilityConfig['status'],
    encryptedCredentials: string,
    settings: Record<string, unknown>,
  ): Promise<AppCapabilityConfig>;
  updateSettings(id: string, settings: Record<string, unknown>): Promise<void>;
  updateCredentials(id: string, encryptedCredentials: string): Promise<void>;
  updateCredentialsByUserAndApp(
    userId: string,
    appKind: string,
    encryptedCredentials: string,
  ): Promise<void>;
  updateStatus(
    id: string,
    status: AppCapabilityConfig['status'],
    lastError?: string | null,
  ): Promise<void>;
  updateSyncState(
    id: string,
    state: {
      lastSyncCursor?: string | null;
      lastSyncAt?: Date | null;
      lastSyncStatus?: AppCapabilityConfig['lastSyncStatus'];
      lastError?: string | null;
    },
  ): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteByUserAndApp(userId: string, appKind: string): Promise<number>;
}

function mapRow(row: AppCapabilityConfigRow): AppCapabilityConfig {
  return row;
}

const SELECT_FIELDS = `SELECT id,
                              user_id AS "userId",
                              app_kind AS "appKind",
                              capability,
                              status,
                              encrypted_credentials AS "encryptedCredentials",
                              settings,
                              last_sync_cursor AS "lastSyncCursor",
                              last_sync_at AS "lastSyncAt",
                              last_sync_status AS "lastSyncStatus",
                              last_error AS "lastError",
                              created_at AS "createdAt",
                              updated_at AS "updatedAt"
                       FROM app_capability_configs`;

export const appCapabilityConfigRepository: AppCapabilityConfigRepository = {
  async findById(id: string): Promise<AppCapabilityConfig | null> {
    const pool = getPool();
    const result = await pool.query<AppCapabilityConfigRow>(
      `${SELECT_FIELDS}
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  },

  async findByUserAppAndCapability(
    userId: string,
    appKind: string,
    capability: string,
  ): Promise<AppCapabilityConfig | null> {
    const pool = getPool();
    const result = await pool.query<AppCapabilityConfigRow>(
      `${SELECT_FIELDS}
       WHERE user_id = $1 AND app_kind = $2 AND capability = $3
       LIMIT 1`,
      [userId, appKind, capability],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  },

  async listByUser(userId: string): Promise<AppCapabilityConfig[]> {
    const pool = getPool();
    const result = await pool.query<AppCapabilityConfigRow>(
      `${SELECT_FIELDS}
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async listByUserAndApp(userId: string, appKind: string): Promise<AppCapabilityConfig[]> {
    const pool = getPool();
    const result = await pool.query<AppCapabilityConfigRow>(
      `${SELECT_FIELDS}
       WHERE user_id = $1 AND app_kind = $2
       ORDER BY created_at ASC`,
      [userId, appKind],
    );
    return result.rows.map(mapRow);
  },

  async listConnected(): Promise<AppCapabilityConfig[]> {
    const pool = getPool();
    const result = await pool.query<AppCapabilityConfigRow>(
      `${SELECT_FIELDS}
       WHERE status = 'connected'
       ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  },

  async upsert(
    userId: string,
    appKind: string,
    capability: string,
    status: AppCapabilityConfig['status'],
    encryptedCredentials: string,
    settings: Record<string, unknown>,
  ): Promise<AppCapabilityConfig> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AppCapabilityConfigRow>(
      `INSERT INTO app_capability_configs (
         id, user_id, app_kind, capability, status, encrypted_credentials, settings
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, app_kind, capability) DO UPDATE
       SET status = EXCLUDED.status,
           encrypted_credentials = EXCLUDED.encrypted_credentials,
           settings = EXCLUDED.settings,
           last_error = NULL,
           updated_at = NOW()
       RETURNING id,
                 user_id AS "userId",
                 app_kind AS "appKind",
                 capability,
                 status,
                 encrypted_credentials AS "encryptedCredentials",
                 settings,
                 last_sync_cursor AS "lastSyncCursor",
                 last_sync_at AS "lastSyncAt",
                 last_sync_status AS "lastSyncStatus",
                 last_error AS "lastError",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [id, userId, appKind, capability, status, encryptedCredentials, JSON.stringify(settings)],
    );
    return result.rows[0]!;
  },

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE app_capability_configs SET settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(settings), id],
    );
  },

  async updateCredentials(id: string, encryptedCredentials: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE app_capability_configs SET encrypted_credentials = $1, updated_at = NOW() WHERE id = $2',
      [encryptedCredentials, id],
    );
  },

  async updateCredentialsByUserAndApp(
    userId: string,
    appKind: string,
    encryptedCredentials: string,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE app_capability_configs
       SET encrypted_credentials = $1,
           updated_at = NOW()
       WHERE user_id = $2 AND app_kind = $3`,
      [encryptedCredentials, userId, appKind],
    );
  },

  async updateStatus(
    id: string,
    status: AppCapabilityConfig['status'],
    lastError: string | null = null,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE app_capability_configs SET status = $1, last_error = $2, updated_at = NOW() WHERE id = $3',
      [status, lastError, id],
    );
  },

  async updateSyncState(
    id: string,
    state: {
      lastSyncCursor?: string | null;
      lastSyncAt?: Date | null;
      lastSyncStatus?: AppCapabilityConfig['lastSyncStatus'];
      lastError?: string | null;
    },
  ): Promise<void> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    if ('lastSyncCursor' in state) {
      values.push(state.lastSyncCursor ?? null);
      assignments.push(`last_sync_cursor = $${values.length}`);
    }

    if ('lastSyncAt' in state) {
      values.push(state.lastSyncAt ?? null);
      assignments.push(`last_sync_at = $${values.length}`);
    }

    if ('lastSyncStatus' in state) {
      values.push(state.lastSyncStatus ?? null);
      assignments.push(`last_sync_status = $${values.length}`);
    }

    if ('lastError' in state) {
      values.push(state.lastError ?? null);
      assignments.push(`last_error = $${values.length}`);
    }

    if (assignments.length === 0) {
      return;
    }

    const pool = getPool();
    values.push(id);
    await pool.query(
      `UPDATE app_capability_configs
       SET ${assignments.join(',\n           ')},
           updated_at = NOW()
       WHERE id = $${values.length}`,
      values,
    );
  },

  async delete(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM app_capability_configs WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  async deleteByUserAndApp(userId: string, appKind: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM app_capability_configs WHERE user_id = $1 AND app_kind = $2',
      [userId, appKind],
    );
    return result.rowCount ?? 0;
  },
};
