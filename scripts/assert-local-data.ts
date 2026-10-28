import { assertLocalDataHosts } from '../packages/config/src/local-data.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

try {
  assertLocalDataHosts(databaseUrl, process.env.REDIS_URL ?? 'redis://localhost:6379');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
