import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface DocumentRow {
  id: string;
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
  create(
    sourceId: string | null,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document>;
  updateContent(id: string, content: string | null): Promise<void>;
}

export const documentRepository: DocumentRepository = {
  async findById(id: string): Promise<Document | null> {
    const pool = getPool();
    const result = await pool.query<DocumentRow>(
      `SELECT id, source_id AS "sourceId", title, content, mime_type AS "mimeType",
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
      `SELECT id, source_id AS "sourceId", title, content, mime_type AS "mimeType",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM documents
       WHERE source_id = $1
       ORDER BY created_at DESC`,
      [sourceId],
    );
    return result.rows;
  },

  async create(
    sourceId: string | null,
    title: string,
    content: string | null,
    mimeType: string,
  ): Promise<Document> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<DocumentRow>(
      `INSERT INTO documents (id, source_id, title, content, mime_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, source_id AS "sourceId", title, content, mime_type AS "mimeType",
                 created_at AS "createdAt", updated_at AS "updatedAt"`,
      [id, sourceId, title, content, mimeType],
    );
    return result.rows[0]!;
  },

  async updateContent(id: string, content: string | null): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE documents SET content = $1, updated_at = NOW() WHERE id = $2',
      [content, id],
    );
  },
};
