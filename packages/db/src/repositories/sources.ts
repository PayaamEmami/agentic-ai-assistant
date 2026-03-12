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
  findByExternalId(userId: string, kind: string, externalId: string): Promise<Source | null>;
  create(
    userId: string,
    kind: string,
    connectorKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source>;
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

  async findByExternalId(userId: string, kind: string, externalId: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, connector_kind AS "connectorKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE user_id = $1 AND kind = $2 AND external_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, kind, externalId],
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
