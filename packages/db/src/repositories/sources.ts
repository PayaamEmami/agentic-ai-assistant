import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface SourceRow {
  id: string;
  userId: string | null;
  kind: string;
  connectorKind: string | null;
  externalId: string | null;
  title: string;
  uri: string | null;
  createdAt: Date;
}

export interface Source extends SourceRow {}

export interface SourceRepository {
  findById(id: string): Promise<Source | null>;
  findByExternalId(userId: string, connectorKind: string, externalId: string): Promise<Source | null>;
  create(
    userId: string,
    kind: string,
    connectorKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source>;
  upsertByExternalId(
    userId: string,
    kind: string,
    connectorKind: string,
    externalId: string,
    title: string,
    uri: string | null,
  ): Promise<Source>;
  update(id: string, title: string, uri: string | null): Promise<void>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<Source[]>;
}

export const sourceRepository: SourceRepository = {
  async findById(id: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, connector_kind AS "connectorKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async findByExternalId(userId: string, connectorKind: string, externalId: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, connector_kind AS "connectorKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE user_id = $1 AND connector_kind = $2 AND external_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, connectorKind, externalId],
    );
    return result.rows[0] ?? null;
  },

  async create(
    userId: string,
    kind: string,
    connectorKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<SourceRow>(
      `INSERT INTO sources (id, user_id, kind, connector_kind, external_id, title, uri)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id AS "userId", kind, connector_kind AS "connectorKind",
                 external_id AS "externalId", title, uri,
                 created_at AS "createdAt"`,
      [id, userId, kind, connectorKind, externalId, title, uri],
    );
    return result.rows[0]!;
  },

  async upsertByExternalId(
    userId: string,
    kind: string,
    connectorKind: string,
    externalId: string,
    title: string,
    uri: string | null,
  ): Promise<Source> {
    const pool = getPool();
    const existing = await sourceRepository.findByExternalId(userId, connectorKind, externalId);
    if (existing) {
      const result = await pool.query<SourceRow>(
        `UPDATE sources
         SET kind = $2, title = $3, uri = $4
         WHERE id = $1
         RETURNING id, user_id AS "userId", kind, connector_kind AS "connectorKind",
                   external_id AS "externalId", title, uri,
                   created_at AS "createdAt"`,
        [existing.id, kind, title, uri],
      );
      return result.rows[0]!;
    }

    return sourceRepository.create(userId, kind, connectorKind, externalId, title, uri);
  },

  async update(id: string, title: string, uri: string | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE sources SET title = $1, uri = $2 WHERE id = $3',
      [title, uri, id],
    );
  },

  async listByUser(userId: string, limit = 50, offset = 0): Promise<Source[]> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, connector_kind AS "connectorKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  },
};
