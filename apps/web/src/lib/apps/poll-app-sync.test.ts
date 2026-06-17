import { describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { pollAppSyncOutcome } from './poll-app-sync';

const { local } = vi.hoisted(() => ({
  local: (relativePath: string) =>
    new URL(relativePath, import.meta.url).pathname.replace(
      /^\/(\w):/,
      (_match, drive: string) => `${drive.toLowerCase()}:`,
    ),
}));

vi.mock(local('../api-client.ts'), () => ({
  api: {
    apps: {
      list: vi.fn(),
    },
  },
}));

describe('pollAppSyncOutcome', () => {
  it('returns completed when a recent manual sync run finishes successfully', async () => {
    const syncRequestedAt = Date.parse('2026-06-03T12:00:00.000Z');

    vi.mocked(api.apps.list).mockResolvedValue({
      apps: [
        {
          kind: 'google',
          displayName: 'Google',
          status: 'connected',
          hasCredentials: true,
          lastError: null,
          knowledge: {
            capability: 'knowledge',
            status: 'connected',
            lastSyncAt: '2026-06-03T12:00:05.000Z',
            lastSyncStatus: 'completed',
            lastError: null,
            hasCredentials: true,
            totalSourceCount: 1,
            searchableSourceCount: 1,
            recentSyncRuns: [
              {
                id: 'run-1',
                trigger: 'manual',
                status: 'completed',
                itemsDiscovered: 1,
                itemsQueued: 1,
                itemsDeleted: 0,
                errorCount: 0,
                errorSummary: null,
                startedAt: '2026-06-03T12:00:01.000Z',
                completedAt: '2026-06-03T12:00:05.000Z',
              },
            ],
            recentSources: [],
          },
          tools: {
            capability: 'tools',
            status: 'connected',
            lastSyncAt: null,
            lastSyncStatus: null,
            lastError: null,
            hasCredentials: true,
            totalSourceCount: 0,
            searchableSourceCount: 0,
            recentSyncRuns: [],
            recentSources: [],
          },
        },
      ],
    });

    await expect(
      pollAppSyncOutcome('google', syncRequestedAt, { intervalMs: 0, maxAttempts: 1 }),
    ).resolves.toBe('completed');
  });

  it('returns timeout when no new sync activity is observed', async () => {
    vi.mocked(api.apps.list).mockResolvedValue({
      apps: [
        {
          kind: 'github',
          displayName: 'GitHub',
          status: 'connected',
          hasCredentials: true,
          lastError: null,
          selectedRepoCount: 1,
          knowledge: {
            capability: 'knowledge',
            status: 'connected',
            lastSyncAt: '2026-06-03T11:00:00.000Z',
            lastSyncStatus: 'completed',
            lastError: null,
            hasCredentials: true,
            totalSourceCount: 1,
            searchableSourceCount: 1,
            recentSyncRuns: [],
            recentSources: [],
          },
          tools: {
            capability: 'tools',
            status: 'connected',
            lastSyncAt: null,
            lastSyncStatus: null,
            lastError: null,
            hasCredentials: true,
            totalSourceCount: 0,
            searchableSourceCount: 0,
            recentSyncRuns: [],
            recentSources: [],
          },
        },
      ],
    });

    await expect(
      pollAppSyncOutcome('github', Date.parse('2026-06-03T12:00:00.000Z'), {
        intervalMs: 0,
        maxAttempts: 1,
      }),
    ).resolves.toBe('timeout');
  });
});
