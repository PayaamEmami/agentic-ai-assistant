import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface ConnectorConfigRow {
  id: string;
  userId: string;
  kind: string;
  status: 'pending' | 'connected' | 'failed';
  credentialsEncrypted: string;
  settings: Record<string, unknown>;
  lastSyncCursor: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: 'pending' | 'running' | 'completed' | 'failed' | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectorConfig extends ConnectorConfigRow {}

export interface ConnectorConfigRepository {
  findById(id: string): Promise<ConnectorConfig | null>;
  findByUserAndKind(userId: string, kind: string): Promise<ConnectorConfig | null>;
  listByUser(userId: string): Promise<ConnectorConfig[]>;
  listConnected(): Promise<ConnectorConfig[]>;
  upsert(
    userId: string,
    kind: string,
    status: ConnectorConfig['status'],
    credentialsEncrypted: string,
    settings: Record<string, unknown>,
  ): Promise<ConnectorConfig>;
  updateSettings(id: string, settings: Record<string, unknown>): Promise<void>;
  updateCredentials(id: string, credentialsEncrypted: string): Promise<void>;
  updateStatus(id: string, status: ConnectorConfig['status'], lastError?: string | null): Promise<void>;
  updateSyncState(
    id: string,
    state: {
      lastSyncCursor?: string | null;
      lastSyncAt?: Date | null;
      lastSyncStatus?: ConnectorConfig['lastSyncStatus'];
      lastError?: string | null;
    },
  ): Promise<void>;
  delete(id: string): Promise<boolean>;
}

function mapRow(row: ConnectorConfigRow): ConnectorConfig {
  return row;
}

export const connectorConfigRepository: ConnectorConfigRepository = {
  async findById(id: string): Promise<ConnectorConfig | null> {
    const pool = getPool();
    const result = await pool.query<ConnectorConfigRow>(
      `SELECT id, user_id AS "userId", kind, status,
              credentials_encrypted AS "credentialsEncrypted",
              settings, last_sync_cursor AS "lastSyncCursor",
              last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM connector_configs
       WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  },

  async findByUserAndKind(userId: string, kind: string): Promise<ConnectorConfig | null> {
    const pool = getPool();
    const result = await pool.query<ConnectorConfigRow>(
      `SELECT id, user_id AS "userId", kind, status,
              credentials_encrypted AS "credentialsEncrypted",
              settings, last_sync_cursor AS "lastSyncCursor",
              last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM connector_configs
       WHERE user_id = $1 AND kind = $2
       LIMIT 1`,
      [userId, kind],
    );
    const row = result.rows[0];
    return row ? mapRow(row) : null;
  },

  async listByUser(userId: string): Promise<ConnectorConfig[]> {
    const pool = getPool();
    const result = await pool.query<ConnectorConfigRow>(
      `SELECT id, user_id AS "userId", kind, status,
              credentials_encrypted AS "credentialsEncrypted",
              settings, last_sync_cursor AS "lastSyncCursor",
              last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM connector_configs
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId],
    );
    return result.rows.map(mapRow);
  },

  async listConnected(): Promise<ConnectorConfig[]> {
    const pool = getPool();
    const result = await pool.query<ConnectorConfigRow>(
      `SELECT id, user_id AS "userId", kind, status,
              credentials_encrypted AS "credentialsEncrypted",
              settings, last_sync_cursor AS "lastSyncCursor",
              last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
              last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM connector_configs
       WHERE status = 'connected'
       ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  },

  async upsert(
    userId: string,
    kind: string,
    status: ConnectorConfig['status'],
    credentialsEncrypted: string,
    settings: Record<string, unknown>,
  ): Promise<ConnectorConfig> {
    const pool = getPool();
    const existing = await connectorConfigRepository.findByUserAndKind(userId, kind);
    if (existing) {
      const result = await pool.query<ConnectorConfigRow>(
        `UPDATE connector_configs
         SET status = $3,
             credentials_encrypted = $4,
             settings = $5,
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, user_id AS "userId", kind, status,
                   credentials_encrypted AS "credentialsEncrypted",
                   settings, last_sync_cursor AS "lastSyncCursor",
                   last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
                   last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [existing.id, userId, status, credentialsEncrypted, JSON.stringify(settings)],
      );
      return result.rows[0]!;
    }

    const id = crypto.randomUUID();
    const result = await pool.query<ConnectorConfigRow>(
      `INSERT INTO connector_configs (
         id, user_id, kind, status, credentials_encrypted, settings
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id AS "userId", kind, status,
                 credentials_encrypted AS "credentialsEncrypted",
                 settings, last_sync_cursor AS "lastSyncCursor",
                 last_sync_at AS "lastSyncAt", last_sync_status AS "lastSyncStatus",
                 last_error AS "lastError", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, userId, kind, status, credentialsEncrypted, JSON.stringify(settings)],
    );
    return result.rows[0]!;
  },

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE connector_configs SET settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(settings), id],
    );
  },

  async updateCredentials(id: string, credentialsEncrypted: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE connector_configs SET credentials_encrypted = $1, updated_at = NOW() WHERE id = $2',
      [credentialsEncrypted, id],
    );
  },

  async updateStatus(id: string, status: ConnectorConfig['status'], lastError: string | null = null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE connector_configs SET status = $1, last_error = $2, updated_at = NOW() WHERE id = $3',
      [status, lastError, id],
    );
  },

  async updateSyncState(
    id: string,
    state: {
      lastSyncCursor?: string | null;
      lastSyncAt?: Date | null;
      lastSyncStatus?: ConnectorConfig['lastSyncStatus'];
      lastError?: string | null;
    },
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `UPDATE connector_configs
       SET last_sync_cursor = COALESCE($1, last_sync_cursor),
           last_sync_at = COALESCE($2, last_sync_at),
           last_sync_status = COALESCE($3, last_sync_status),
           last_error = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [
        state.lastSyncCursor ?? null,
        state.lastSyncAt ?? null,
        state.lastSyncStatus ?? null,
        state.lastError ?? null,
        id,
      ],
    );
  },

  async delete(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM connector_configs WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },
};
