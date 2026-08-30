'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { RunActivityLog } from '@/components/automation/run-activity-log';
import {
  formatRunTime,
  isRunActive,
  runStatusBadge,
  runSummary,
  stageLabel,
} from '@/lib/automation/automation-status';
import { useRunActivity } from '@/lib/automation/use-run-activity';
import type { AutomationRun } from '@/lib/api-client';

interface RunListProps {
  runs: AutomationRun[];
  onReload: () => Promise<void>;
}

function RunRow({ run, onReload }: { run: AutomationRun; onReload: () => Promise<void> }) {
  const [open, setOpen] = useState(isRunActive(run));
  const live = isRunActive(run);
  const status = runStatusBadge(run.status);
  const { events, loading } = useRunActivity({
    runId: run.id,
    conversationId: run.conversationId,
    live,
    enabled: open,
    onRunFinished: () => {
      void onReload();
    },
  });

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-lg border border-border-subtle bg-surface-input/60"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {live ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            ) : null}
            <Badge variant={status.variant} className="font-normal">
              {status.label}
            </Badge>
            {run.dryRun ? (
              <Badge variant="neutral" className="font-normal">
                Dry run
              </Badge>
            ) : null}
            <span className="text-xs text-foreground-muted">{formatRunTime(run.startedAt)}</span>
          </div>
          <p className="text-sm text-foreground">{runSummary(run)}</p>
          {live && run.currentStage ? (
            <p className="text-xs font-medium text-foreground-muted">
              {stageLabel(run.currentStage)}
            </p>
          ) : null}
        </div>
        {run.pullRequestUrl ? (
          <a
            href={run.pullRequestUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs text-accent hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            View PR
          </a>
        ) : null}
      </summary>
      <div className="px-3 pb-3">
        {run.rationale ? (
          <p className="mb-2 text-sm leading-relaxed text-foreground-muted">{run.rationale}</p>
        ) : null}
        <RunActivityLog events={events} loading={loading} live={live} />
      </div>
    </details>
  );
}

export function RunList({ runs, onReload }: RunListProps) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No runs yet. Use Run now or wait for the next scheduled fire.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} onReload={onReload} />
      ))}
    </div>
  );
}
