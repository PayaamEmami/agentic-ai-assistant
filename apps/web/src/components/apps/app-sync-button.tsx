'use client';

import { cn } from '@/lib/cn';
import { type AppSummary } from '@/lib/api-client';
import { SyncIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/icon-button';
import { getAppSyncDisabledReason, isAppSyncDisabled } from '@/lib/apps/sync-labels';

interface AppSyncButtonProps {
  app: AppSummary;
  syncingKind: AppSummary['kind'] | null;
  onSync: (kind: AppSummary['kind']) => void;
}

export function AppSyncButton({ app, syncingKind, onSync }: AppSyncButtonProps) {
  const disabledReason = getAppSyncDisabledReason(app);
  const disabled = isAppSyncDisabled(app, syncingKind);
  const loading = syncingKind === app.kind;

  return (
    <span
      title={disabledReason ?? undefined}
      className={cn('inline-flex', disabled && !loading && 'cursor-not-allowed')}
    >
      <IconButton
        onClick={() => onSync(app.kind)}
        disabled={disabled}
        loading={loading}
        title={disabledReason ? undefined : `Sync ${app.displayName}`}
        aria-label={
          loading
            ? `Syncing ${app.displayName}`
            : disabledReason
              ? disabledReason
              : `Sync ${app.displayName}`
        }
      >
        <SyncIcon />
      </IconButton>
    </span>
  );
}
