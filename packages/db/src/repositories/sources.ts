import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface SourceRow {
  id: string;
  userId: string | null;
  kind: string;
  appKind: string | null;
  externalId: string | null;
  title: string;
  uri: string | null;
  createdAt: Date;
}

export interface Source extends SourceRow {}

export interface IndexedSourceSummary {
  id: string;
  kind: string;
  title: string;
  uri: string | null;
  mimeType: string | null;
  updatedAt: Date;
}

export interface AppSourceStats {
  totalSources: number;
  searchableSources: number;
}

export interface SourceRepository {
  findById(id: string): Promise<Source | null>;
  findByExternalId(userId: string, appKind: string, externalId: string): Promise<Source | null>;
  create(
    userId: string,
    kind: string,
    appKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source>;
  upsertByExternalId(
    userId: string,
    kind: string,
    appKind: string,
    externalId: string,
    title: string,
    uri: string | null,
  ): Promise<Source>;
  update(id: string, title: string, uri: string | null): Promise<void>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<Source[]>;
  listIndexedByUserAndApp(userId: string, appKind: string, limit?: number): Promise<IndexedSourceSummary[]>;
  getAppSourceStats(userId: string, appKind: string): Promise<AppSourceStats>;
  deleteByUserAndApp(userId: string, appKind: string): Promise<number>;
}

export const sourceRepository: SourceRepository = {
  async findById(id: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, app_kind AS "appKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async findByExternalId(userId: string, appKind: string, externalId: string): Promise<Source | null> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, app_kind AS "appKind",
              external_id AS "externalId", title, uri,
              created_at AS "createdAt"
       FROM sources
       WHERE user_id = $1 AND app_kind = $2 AND external_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, appKind, externalId],
    );
    return result.rows[0] ?? null;
  },

  async create(
    userId: string,
    kind: string,
    appKind: string | null,
    externalId: string | null,
    title: string,
    uri: string | null,
  ): Promise<Source> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<SourceRow>(
      `INSERT INTO sources (id, user_id, kind, app_kind, external_id, title, uri)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id AS "userId", kind, app_kind AS "appKind",
                 external_id AS "externalId", title, uri,
                 created_at AS "createdAt"`,
      [id, userId, kind, appKind, externalId, title, uri],
    );
    return result.rows[0]!;
  },

  async upsertByExternalId(
    userId: string,
    kind: string,
    appKind: string,
    externalId: string,
    title: string,
    uri: string | null,
  ): Promise<Source> {
    const pool = getPool();
    const existing = await sourceRepository.findByExternalId(userId, appKind, externalId);
    if (existing) {
      const result = await pool.query<SourceRow>(
        `UPDATE sources
         SET kind = $2, title = $3, uri = $4
         WHERE id = $1
         RETURNING id, user_id AS "userId", kind, app_kind AS "appKind",
                   external_id AS "externalId", title, uri,
                   created_at AS "createdAt"`,
        [existing.id, kind, title, uri],
      );
      return result.rows[0]!;
    }

    return sourceRepository.create(userId, kind, appKind, externalId, title, uri);
  },

  async update(id: string, title: string, uri: string | null): Promise<void> {
    const pool = getPool();
    await pool.query('UPDATE sources SET title = $1, uri = $2 WHERE id = $3', [title, uri, id]);
  },

  async listByUser(userId: string, limit = 50, offset = 0): Promise<Source[]> {
    const pool = getPool();
    const result = await pool.query<SourceRow>(
      `SELECT id, user_id AS "userId", kind, app_kind AS "appKind",
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

  async listIndexedByUserAndApp(
    userId: string,
    appKind: string,
    limit = 8,
  ): Promise<IndexedSourceSummary[]> {
    const pool = getPool();
    const result = await pool.query<IndexedSourceSummary>(
      `SELECT s.id,
              s.kind,
              s.title,
              s.uri,
              d.mime_type AS "mimeType",
              COALESCE(d.updated_at, s.created_at) AS "updatedAt"
       FROM sources AS s
       LEFT JOIN documents AS d ON d.source_id = s.id
       WHERE s.user_id = $1 AND s.app_kind = $2
       ORDER BY COALESCE(d.updated_at, s.created_at) DESC, s.created_at DESC
       LIMIT $3`,
      [userId, appKind, limit],
    );
    return result.rows;
  },

  async getAppSourceStats(userId: string, appKind: string): Promise<AppSourceStats> {
    const pool = getPool();
    const result = await pool.query<AppSourceStats>(
      `SELECT COUNT(DISTINCT s.id)::int AS "totalSources",
              COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN s.id END)::int AS "searchableSources"
       FROM sources AS s
       LEFT JOIN documents AS d ON d.source_id = s.id
       LEFT JOIN chunks AS c ON c.document_id = d.id
       LEFT JOIN embeddings AS e ON e.chunk_id = c.id AND e.vector IS NOT NULL
       WHERE s.user_id = $1 AND s.app_kind = $2`,
      [userId, appKind],
    );
    return result.rows[0] ?? { totalSources: 0, searchableSources: 0 };
  },

  async deleteByUserAndApp(userId: string, appKind: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM sources
       WHERE user_id = $1 AND app_kind = $2`,
      [userId, appKind],
    );
    return result.rowCount ?? 0;
  },
};
