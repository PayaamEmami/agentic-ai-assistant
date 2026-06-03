'use client';

import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { api, type AppSummary } from '@/lib/api-client';
import { pollAppSyncOutcome } from '@/lib/apps/poll-app-sync';
import { appSyncOutcomeMessage, appSyncStartedMessage } from '@/lib/apps/sync-labels';

export function useAppSync(onReload: () => Promise<void>) {
  const toast = useToast();
  const [syncingKind, setSyncingKind] = useState<AppSummary['kind'] | null>(null);

  const syncApp = useCallback(
    async (kind: AppSummary['kind'], displayName: string) => {
      setSyncingKind(kind);
      const syncRequestedAt = Date.now();

      try {
        toast.info(appSyncStartedMessage(displayName));
        await api.apps.sync(kind);

        const outcome = await pollAppSyncOutcome(kind, syncRequestedAt);
        await onReload();

        const { apps } = await api.apps.list();
        const app = apps.find((candidate) => candidate.kind === kind);
        const message = appSyncOutcomeMessage(
          displayName,
          outcome,
          app?.knowledge.lastError ?? app?.lastError,
        );

        if (outcome === 'completed') {
          toast.success(message);
        } else if (outcome === 'failed') {
          toast.error(message);
        } else {
          toast.warning(message);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to queue sync');
        throw error;
      } finally {
        setSyncingKind(null);
      }
    },
    [onReload, toast],
  );

  return { syncingKind, syncApp };
}
