import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface SourceRow {
  id: string;
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
  findByExternalId(kind: string, externalId: string): Promise<Source | null>;
  create(
    kind: string,
    connectorKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source>;
  list(limit?: number, offset?: number): Promise<Source[]>;
}

export const sourceRepository: SourceRepository = {
  async findById(id: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, kind, connector_kind AS "connectorKind", external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async findByExternalId(kind: string, externalId: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, kind, connector_kind AS "connectorKind", external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE kind = $1 AND external_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [kind, externalId],
    );
    return result.rows[0] ?? null;
  },

  async create(
    kind: string,
    connectorKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<SourceRow>(
      `INSERT INTO sources (id, kind, connector_kind, external_id, title, uri)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, kind, connector_kind AS "connectorKind", external_id AS "externalId", title, uri,
                 created_at AS "createdAt"`,
      [id, kind, connectorKind, externalId, title, uri],
    );
    return result.rows[0]!;
  },

  async list(limit = 50, offset = 0): Promise<Source[]> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, kind, connector_kind AS "connectorKind", external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows;
  },
};
