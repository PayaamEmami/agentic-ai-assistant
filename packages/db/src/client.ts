import { Pool, type PoolClient } from 'pg';
import {
  databaseQueryCounter,
  databaseQueryDurationMs,
  withSpan,
} from '@aaa/observability';

const PATCHED = Symbol('aaa.db.query.patched');

type QueryArgs = [string] | [string, unknown[]] | [{ text: string; values?: unknown[] }];

function getQueryText(arg: QueryArgs[0]): string {
  return typeof arg === 'string' ? arg : arg.text;
}

function getOperationName(arg: QueryArgs[0]): string {
  const text = getQueryText(arg).trim();
  const match = text.match(/^([a-z]+)/i);
  return match?.[1]?.toUpperCase() ?? 'UNKNOWN';
}

async function recordQuery<T>(arg: QueryArgs[0], fn: () => Promise<T>): Promise<T> {
  const operation = getOperationName(arg);
  const startedAt = Date.now();

  try {
    const result = await withSpan(
      `db.${operation.toLowerCase()}`,
      {
        'db.system': 'postgresql',
        'db.operation': operation,
      },
      fn,
    );

    const durationMs = Date.now() - startedAt;
    databaseQueryCounter.inc({ operation, outcome: 'success' });
    databaseQueryDurationMs.observe({ operation, outcome: 'success' }, durationMs);
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    databaseQueryCounter.inc({ operation, outcome: 'failure' });
    databaseQueryDurationMs.observe({ operation, outcome: 'failure' }, durationMs);
    throw error;
  }
}

function patchClient(client: PoolClient): void {
  if ((client as unknown as Record<PropertyKey, unknown>)[PATCHED]) {
    return;
  }

  const originalQuery = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
  client.query = (async (...args: unknown[]) => {
    return recordQuery(args[0] as QueryArgs[0], () => originalQuery(...args));
  }) as PoolClient['query'];

  (client as unknown as Record<PropertyKey, unknown>)[PATCHED] = true;
}

export function createPool(connectionString: string, poolSize?: number): Pool {
  const pool = new Pool({
    connectionString,
    max: poolSize ?? 10,
  });

  const originalQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
  pool.query = (async (...args: unknown[]) => {
    return recordQuery(args[0] as QueryArgs[0], () => originalQuery(...args));
  }) as Pool['query'];

  pool.on('connect', (client) => {
    patchClient(client);
  });

  return pool;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    const poolSize = process.env['DATABASE_POOL_SIZE']
      ? parseInt(process.env['DATABASE_POOL_SIZE'], 10)
      : undefined;
    pool = createPool(connectionString, poolSize);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function pingDatabase(): Promise<void> {
  await getPool().query('SELECT 1');
}
