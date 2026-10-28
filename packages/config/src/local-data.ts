const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
const LOCAL_REDIS_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'redis']);

export function assertLocalDataHosts(databaseUrl: string, redisUrl: string): void {
  assertAllowedHost(databaseUrl, LOCAL_DATABASE_HOSTS, 'DATABASE_URL');
  assertAllowedHost(redisUrl, LOCAL_REDIS_HOSTS, 'REDIS_URL');
}

function assertAllowedHost(rawUrl: string, allowed: Set<string>, name: string): void {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    host = '';
  }

  if (!allowed.has(host)) {
    throw new Error(
      `${name} host "${host || rawUrl}" is not local. Development only allows ${[...allowed].join(', ')}.`,
    );
  }
}
