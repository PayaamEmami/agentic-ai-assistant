import type { AppSummary } from '@/lib/api-client';
import type { AppSyncPollOutcome } from './poll-app-sync';

export function getAppSyncDisabledReason(app: AppSummary): string | null {
  if (app.kind === 'github' && (app.selectedRepoCount ?? 0) === 0) {
    return 'Select and save at least one repository before syncing.';
  }

  return null;
}

export function isAppSyncDisabled(
  app: AppSummary,
  syncingKind: AppSummary['kind'] | null,
): boolean {
  return getAppSyncDisabledReason(app) !== null || syncingKind === app.kind;
}

export function appSyncStartedMessage(displayName: string): string {
  return `Syncing ${displayName}...`;
}

export function appSyncOutcomeMessage(
  displayName: string,
  outcome: AppSyncPollOutcome,
  lastError?: string | null,
): string {
  if (outcome === 'completed') {
    return `${displayName} sync completed.`;
  }

  if (outcome === 'failed') {
    return lastError ? `${displayName} sync failed: ${lastError}` : `${displayName} sync failed.`;
  }

  return `${displayName} sync is still running. Check back in a moment.`;
}
