import { Pool } from 'pg';

export function createPool(connectionString: string, poolSize?: number): Pool {
  return new Pool({
    connectionString,
    max: poolSize ?? 10,
  });
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
