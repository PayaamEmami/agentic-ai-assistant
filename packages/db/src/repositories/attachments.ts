import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface AttachmentRow {
  id: string;
  userId: string;
  messageId: string | null;
  documentId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
  textContent: string | null;
  createdAt: Date;
}

export interface Attachment extends AttachmentRow {}

export interface AttachmentRepository {
  findById(id: string): Promise<Attachment | null>;
  findByIdForUser(id: string, userId: string): Promise<Attachment | null>;
  findByIdsForUser(ids: string[], userId: string): Promise<Attachment[]>;
  listByMessage(messageId: string): Promise<Attachment[]>;
  create(
    userId: string,
    kind: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    data: Buffer,
    textContent: string | null,
  ): Promise<Attachment>;
  attachToMessage(id: string, messageId: string, userId: string): Promise<Attachment | null>;
  setDocument(id: string, documentId: string, userId: string): Promise<void>;
}

const SELECT_FIELDS = `SELECT id, user_id AS "userId", message_id AS "messageId",
                              document_id AS "documentId", kind, file_name AS "fileName",
                              mime_type AS "mimeType", size_bytes::double precision AS "sizeBytes",
                              data, text_content AS "textContent", created_at AS "createdAt"
                       FROM attachments`;

export const attachmentRepository: AttachmentRepository = {
  async findById(id: string): Promise<Attachment | null> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(`${SELECT_FIELDS} WHERE id = $1`, [id]);
    return result.rows[0] ?? null;
  },

  async findByIdForUser(id: string, userId: string): Promise<Attachment | null> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `${SELECT_FIELDS} WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return result.rows[0] ?? null;
  },

  async findByIdsForUser(ids: string[], userId: string): Promise<Attachment[]> {
    if (ids.length === 0) {
      return [];
    }

    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `${SELECT_FIELDS} WHERE user_id = $1 AND id = ANY($2::uuid[])`,
      [userId, ids],
    );

    const byId = new Map(result.rows.map((row) => [row.id, row] as const));
    return ids.map((id) => byId.get(id)).filter((row): row is Attachment => row !== undefined);
  },

  async listByMessage(messageId: string): Promise<Attachment[]> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `${SELECT_FIELDS} WHERE message_id = $1 ORDER BY created_at ASC`,
      [messageId],
    );
    return result.rows;
  },

  async create(
    userId: string,
    kind: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    data: Buffer,
    textContent: string | null,
  ): Promise<Attachment> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AttachmentRow>(
      `INSERT INTO attachments (id, user_id, kind, file_name, mime_type, size_bytes, data, text_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id AS "userId", message_id AS "messageId",
                 document_id AS "documentId", kind, file_name AS "fileName",
                 mime_type AS "mimeType", size_bytes::double precision AS "sizeBytes",
                 data, text_content AS "textContent", created_at AS "createdAt"`,
      [id, userId, kind, fileName, mimeType, sizeBytes, data, textContent],
    );
    return result.rows[0]!;
  },

  async attachToMessage(id: string, messageId: string, userId: string): Promise<Attachment | null> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `UPDATE attachments
       SET message_id = $1
       WHERE id = $2 AND user_id = $3 AND (message_id IS NULL OR message_id = $1)
       RETURNING id, user_id AS "userId", message_id AS "messageId",
                 document_id AS "documentId", kind, file_name AS "fileName",
                 mime_type AS "mimeType", size_bytes::double precision AS "sizeBytes",
                 data, text_content AS "textContent", created_at AS "createdAt"`,
      [messageId, id, userId],
    );
    return result.rows[0] ?? null;
  },

  async setDocument(id: string, documentId: string, userId: string): Promise<void> {
    const pool = getPool();
    await pool.query(
      'UPDATE attachments SET document_id = $1 WHERE id = $2 AND user_id = $3',
      [documentId, id, userId],
    );
  },
};
