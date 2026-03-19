import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface DocumentRow {
  id: string;
  userId: string | null;
  sourceId: string | null;
  title: string;
  content: string | null;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document extends DocumentRow {}

export interface DocumentRepository {
  findById(id: string): Promise<Document | null>;
  findBySourceId(sourceId: string): Promise<Document[]>;
  listByUser(userId: string, limit?: number, offset?: number): Promise<Document[]>;
  create(
    userId: string,
    sourceId: string | null,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document>;
  upsertBySourceId(
    userId: string,
    sourceId: string,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document>;
  updateContent(id: string, content: string | null): Promise<void>;
  updateDocument(
    id: string,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<void>;
}

export const documentRepository: DocumentRepository = {
  async findById(id: string): Promise<Document | null> {
    const pool = getPool();
    const result = await pool.query<DocumentRow>(
      `SELECT id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async findBySourceId(sourceId: string): Promise<Document[]> {
    const pool = getPool();
    const result = await pool.query<DocumentRow>(
      `SELECT id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents
       WHERE source_id = $1
       ORDER BY created_at DESC`,
      [sourceId],
    );
    return result.rows;
  },

  async listByUser(userId: string, limit = 100, offset = 0): Promise<Document[]> {
    const pool = getPool();
    const result = await pool.query<DocumentRow>(
      `SELECT id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return result.rows;
  },

  async create(
    userId: string,
    sourceId: string | null,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<DocumentRow>(
      `INSERT INTO documents (id, user_id, source_id, title, content, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, userId, sourceId, title, content, mimeType],
    );
    return result.rows[0]!;
  },

  async upsertBySourceId(
    userId: string,
    sourceId: string,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document> {
    const pool = getPool();
    const existing = await pool.query<DocumentRow>(
      `SELECT id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents
       WHERE source_id = $1
       LIMIT 1`,
      [sourceId],
    );

    const row = existing.rows[0];
    if (row) {
      const result = await pool.query<DocumentRow>(
        `UPDATE documents
         SET title = $2, content = $3, mime_type = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING id, user_id AS "userId", source_id AS "sourceId", title, content, mime_type AS "mimeType",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [row.id, title, content, mimeType],
      );
      return result.rows[0]!;
    }

    return documentRepository.create(userId, sourceId, title, content, mimeType);
  },

  async updateContent(id: string, content: string | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE documents SET content = $1, updated_at = NOW() WHERE id = $2',
      [content, id],
    );
  },

  async updateDocument(
    id: string,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE documents SET title = $1, content = $2, mime_type = $3, updated_at = NOW() WHERE id = $4',
      [title, content, mimeType, id],
    );
  },
};
