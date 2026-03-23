import type { MemoryDbAdapter, MemoryRow, PreferenceRow } from './db-adapter.js';

export interface QueryExecutor {
  query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
}

interface MemorySqlRow {
  id: string;
  userId: string;
  kind: string;
  content: string;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface PreferenceSqlRow {
  key: string;
  value: string;
  updatedAt: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toMetadata(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function toMemoryRow(row: MemorySqlRow): MemoryRow {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    content: row.content,
    metadata: toMetadata(row.metadata),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function toPreferenceRow(row: PreferenceSqlRow): PreferenceRow {
  return {
    key: row.key,
    value: row.value,
    updatedAt: toDate(row.updatedAt),
  };
}

function normalizeLimit(limit?: number): number | undefined {
  if (limit == null) {
    return undefined;
  }

  if (!Number.isFinite(limit)) {
    return undefined;
  }

  const normalized = Math.floor(limit);
  return normalized > 0 ? normalized : undefined;
}

export class PgMemoryAdapter implements MemoryDbAdapter {
  constructor(private readonly executor: QueryExecutor) {}

  async getMemory(id: string): Promise<MemoryRow | null> {
    const sql = `
      SELECT
        id,
        user_id AS "userId",
        kind,
        content,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM memories
      WHERE id = $1
      LIMIT 1
    `;
    const result = await this.executor.query<MemorySqlRow>(sql, [id]);
    const row = result.rows[0];
    return row ? toMemoryRow(row) : null;
  }

  async insertMemory(
    userId: string,
    kind: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<MemoryRow> {
    const sql = `
      INSERT INTO memories (user_id, kind, content, metadata)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING
        id,
        user_id AS "userId",
        kind,
        content,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
    const result = await this.executor.query<MemorySqlRow>(sql, [userId, kind, content, JSON.stringify(metadata)]);
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert memory');
    }
    return toMemoryRow(row);
  }

  async updateMemory(
    id: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const sql = `
      UPDATE memories
      SET
        content = $1,
        metadata = $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
    `;
    await this.executor.query(sql, [content, JSON.stringify(metadata), id]);
  }

  async findMemories(userId: string, kind?: string, limit?: number): Promise<MemoryRow[]> {
    const params: unknown[] = [userId];
    let sql = `
      SELECT
        id,
        user_id AS "userId",
        kind,
        content,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM memories
      WHERE user_id = $1
    `;

    if (kind != null) {
      params.push(kind);
      sql += ` AND kind = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const normalizedLimit = normalizeLimit(limit);
    if (normalizedLimit != null) {
      params.push(normalizedLimit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await this.executor.query<MemorySqlRow>(sql, params);
    return result.rows.map(toMemoryRow);
  }

  async searchMemories(userId: string, query: string, limit?: number): Promise<MemoryRow[]> {
    const params: unknown[] = [userId, `%${query}%`];
    let sql = `
      SELECT
        id,
        user_id AS "userId",
        kind,
        content,
        metadata,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM memories
      WHERE user_id = $1
        AND content ILIKE $2
      ORDER BY created_at DESC
    `;

    const normalizedLimit = normalizeLimit(limit);
    if (normalizedLimit != null) {
      params.push(normalizedLimit);
      sql += ` LIMIT $${params.length}`;
    }

    const result = await this.executor.query<MemorySqlRow>(sql, params);
    return result.rows.map(toMemoryRow);
  }

  async deleteMemory(id: string): Promise<void> {
    await this.executor.query('DELETE FROM memories WHERE id = $1', [id]);
  }

  async getPreferences(userId: string): Promise<PreferenceRow[]> {
    const sql = `
      SELECT
        key,
        value,
        updated_at AS "updatedAt"
      FROM preferences
      WHERE user_id = $1
      ORDER BY key ASC
    `;
    const result = await this.executor.query<PreferenceSqlRow>(sql, [userId]);
    return result.rows.map(toPreferenceRow);
  }

  async getPreference(userId: string, key: string): Promise<PreferenceRow | null> {
    const sql = `
      SELECT
        key,
        value,
        updated_at AS "updatedAt"
      FROM preferences
      WHERE user_id = $1
        AND key = $2
      LIMIT 1
    `;
    const result = await this.executor.query<PreferenceSqlRow>(sql, [userId, key]);
    const row = result.rows[0];
    return row ? toPreferenceRow(row) : null;
  }

  async upsertPreference(userId: string, key: string, value: string): Promise<void> {
    const sql = `
      INSERT INTO preferences (user_id, key, value)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
    `;
    await this.executor.query(sql, [userId, key, value]);
  }

  async deletePreference(userId: string, key: string): Promise<void> {
    await this.executor.query(
      'DELETE FROM preferences WHERE user_id = $1 AND key = $2',
      [userId, key],
    );
  }
}
