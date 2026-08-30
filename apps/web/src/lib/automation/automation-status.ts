import { AUTOMATION_RUN_STAGE_LABELS, type AutomationRunStage } from '@aaa/shared';
import type { AutomationRun } from '@/lib/api-client';

type BadgeVariant = 'neutral' | 'accent' | 'success' | 'error' | 'warning';

const STATUS_BADGES: Record<AutomationRun['status'], { label: string; variant: BadgeVariant }> = {
  queued: { label: 'Queued', variant: 'neutral' },
  running: { label: 'Running', variant: 'accent' },
  completed: { label: 'Completed', variant: 'success' },
  // Skipping is a healthy outcome (the agent declined to guess), so it reads as a
  // neutral note rather than a failure.
  skipped: { label: 'Skipped', variant: 'neutral' },
  failed: { label: 'Failed', variant: 'error' },
};

export function runStatusBadge(status: AutomationRun['status']): {
  label: string;
  variant: BadgeVariant;
} {
  return STATUS_BADGES[status];
}

export function isRunActive(run: AutomationRun): boolean {
  return run.status === 'queued' || run.status === 'running';
}

export function stageLabel(stage: string | null): string | null {
  if (!stage) {
    return null;
  }

  return AUTOMATION_RUN_STAGE_LABELS[stage as AutomationRunStage] ?? stage;
}

/** One-line summary of what a finished run did, for the collapsed row. */
export function runSummary(run: AutomationRun): string {
  if (run.status === 'failed') {
    return run.error ?? 'The run failed.';
  }

  if (run.status === 'skipped') {
    return run.skipReason ?? 'No work was started.';
  }

  if (run.selectedCardTitle) {
    const prefix = run.dryRun ? 'Would implement' : 'Implemented';
    return run.selectedRepo
      ? `${prefix} "${run.selectedCardTitle}" in ${run.selectedRepo}`
      : `${prefix} "${run.selectedCardTitle}"`;
  }

  return stageLabel(run.currentStage) ?? 'Starting up';
}

export function formatRunTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function describeCron(cron: string, timezone: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return `${cron} (${timezone})`;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  // Only the common "every day at HH:MM" shape gets prose; anything else keeps
  // the raw expression so the description is never subtly wrong.
  const isDaily = dayOfMonth === '*' && month === '*' && dayOfWeek === '*';
  if (isDaily && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    return `Daily at ${time} (${timezone})`;
  }

  return `${cron} (${timezone})`;
}
