import { describe, expect, it } from 'vitest';
import { assertLocalDataHosts } from './local-data.js';

describe('assertLocalDataHosts', () => {
  it('accepts loopback and compose service hosts', () => {
    expect(() =>
      assertLocalDataHosts(
        'postgresql://aaa:aaa_dev_password@localhost:5432/aaa',
        'redis://localhost:6379',
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalDataHosts(
        'postgresql://aaa:aaa_dev_password@postgres:5432/aaa',
        'redis://redis:6379',
      ),
    ).not.toThrow();
    expect(() =>
      assertLocalDataHosts('postgresql://aaa:secret@127.0.0.1:5432/aaa', 'redis://127.0.0.1:6379'),
    ).not.toThrow();
  });

  it('rejects remote database and redis hosts', () => {
    expect(() =>
      assertLocalDataHosts(
        'postgresql://aaa:secret@db.example.com:5432/aaa',
        'redis://localhost:6379',
      ),
    ).toThrow(/DATABASE_URL host "db.example.com"/);
    expect(() =>
      assertLocalDataHosts(
        'postgresql://aaa:secret@localhost:5432/aaa',
        'redis://cache.example.com:6379',
      ),
    ).toThrow(/REDIS_URL host "cache.example.com"/);
  });
});
