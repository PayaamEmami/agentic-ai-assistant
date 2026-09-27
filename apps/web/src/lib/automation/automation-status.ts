import { AUTOMATION_RUN_STAGE_LABELS, type AutomationRunStage } from '@aaa/shared';
import type { AutomationRun } from '@/lib/api-client';
import { describeTiming } from './schedule-cron';

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

  if (run.rationale) {
    const text = run.rationale.trim();
    return text.length > 160 ? `${text.slice(0, 159).trimEnd()}…` : text;
  }

  if (run.selectedCardTitle) {
    const prefix = run.dryRun ? 'Would implement' : 'Implemented';
    return run.selectedRepo
      ? `${prefix} "${run.selectedCardTitle}" in ${run.selectedRepo}`
      : `${prefix} "${run.selectedCardTitle}"`;
  }

  if (run.status === 'queued') {
    return 'Waiting to start';
  }

  if (run.status === 'running') {
    return stageLabel(run.currentStage) ?? 'Running';
  }

  return 'Finished';
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
  return describeTiming(cron, timezone);
}
