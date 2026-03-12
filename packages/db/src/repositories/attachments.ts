import crypto from 'node:crypto';
import { getPool } from '../client.js';

interface AttachmentRow {
  id: string;
  messageId: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
}

export interface Attachment extends AttachmentRow {}

export interface AttachmentRepository {
  findById(id: string): Promise<Attachment | null>;
  listByMessage(messageId: string): Promise<Attachment[]>;
  create(
    messageId: string,
    kind: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    storageKey: string,
  ): Promise<Attachment>;
}

export const attachmentRepository: AttachmentRepository = {
  async findById(id: string): Promise<Attachment | null> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `SELECT id, message_id AS "messageId", kind, file_name AS "fileName", mime_type AS "mimeType",
              size_bytes::double precision AS "sizeBytes", storage_key AS "storageKey", created_at AS "createdAt"
       FROM attachments
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  },

  async listByMessage(messageId: string): Promise<Attachment[]> {
    const pool = getPool();
    const result = await pool.query<AttachmentRow>(
      `SELECT id, message_id AS "messageId", kind, file_name AS "fileName", mime_type AS "mimeType",
              size_bytes::double precision AS "sizeBytes", storage_key AS "storageKey", created_at AS "createdAt"
       FROM attachments
       WHERE message_id = $1
       ORDER BY created_at ASC`,
      [messageId],
    );
    return result.rows;
  },

  async create(
    messageId: string,
    kind: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    storageKey: string,
  ): Promise<Attachment> {
    const pool = getPool();
    const id = crypto.randomUUID();
    const result = await pool.query<AttachmentRow>(
      `INSERT INTO attachments (id, message_id, kind, file_name, mime_type, size_bytes, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, message_id AS "messageId", kind, file_name AS "fileName", mime_type AS "mimeType",
                 size_bytes::double precision AS "sizeBytes", storage_key AS "storageKey", created_at AS "createdAt"`,
      [id, messageId, kind, fileName, mimeType, sizeBytes, storageKey],
    );
    return result.rows[0]!;
  },
};
