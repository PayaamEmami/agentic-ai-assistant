import { api, type AppSummary } from '@/lib/api-client';

export type AppSyncPollOutcome = 'completed' | 'failed' | 'timeout';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findRecentManualSyncRun(app: AppSummary, syncRequestedAt: number) {
  return app.knowledge.recentSyncRuns.find(
    (run) =>
      run.trigger === 'manual' && new Date(run.startedAt).getTime() >= syncRequestedAt - 5_000,
  );
}

export async function pollAppSyncOutcome(
  kind: AppSummary['kind'],
  syncRequestedAt: number,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<AppSyncPollOutcome> {
  const intervalMs = options?.intervalMs ?? 2_000;
  const maxAttempts = options?.maxAttempts ?? 90;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(intervalMs);
    }

    const { apps } = await api.apps.list();
    const app = apps.find((candidate) => candidate.kind === kind);
    if (!app) {
      continue;
    }

    const recentRun = findRecentManualSyncRun(app, syncRequestedAt);
    if (recentRun) {
      if (recentRun.status === 'completed') {
        return 'completed';
      }
      if (recentRun.status === 'failed') {
        return 'failed';
      }
      continue;
    }

    const lastSyncAt = app.knowledge.lastSyncAt
      ? new Date(app.knowledge.lastSyncAt).getTime()
      : 0;
    if (lastSyncAt < syncRequestedAt - 5_000) {
      continue;
    }

    if (app.knowledge.lastSyncStatus === 'completed') {
      return 'completed';
    }
    if (app.knowledge.lastSyncStatus === 'failed') {
      return 'failed';
    }
  }

  return 'timeout';
}
