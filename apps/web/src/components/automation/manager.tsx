'use client';

import { useState } from 'react';
import { McpConnectionSection } from '@/components/automation/mcp-connection';
import { RunList } from '@/components/automation/run-list';
import { ScheduleForm } from '@/components/automation/schedule-form';
import { PlusIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { describeTiming } from '@/lib/automation/schedule-cron';
import { useAutomationSchedules } from '@/lib/automation/use-automation-schedules';
import type { AutomationSchedule } from '@/lib/api-client';

export function AutomationManager() {
  const {
    schedules,
    runs,
    loading,
    busy,
    reload,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runNow,
  } = useAutomationSchedules();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const editing = schedules.find((schedule) => schedule.id === editingId) ?? null;

  return (
    <div className="space-y-10">
      <McpConnectionSection />

      <section className="space-y-4 border-t border-border pt-8">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-medium text-foreground">Schedules</h2>
            <IconButton
              onClick={() => {
                setCreating(true);
                setEditingId(null);
              }}
              disabled={busy}
              title="New schedule"
              aria-label="New schedule"
            >
              <PlusIcon width={18} height={18} />
            </IconButton>
          </div>
          <p className="max-w-2xl text-sm text-foreground-muted">
            Write a prompt and choose when it should run. Each fire uses the same assistant as
            chat, including whatever tools and MCP servers are connected.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-foreground-muted">Loading schedules...</p>
        ) : schedules.length === 0 && !creating ? (
          <p className="text-sm text-foreground-muted">No schedules yet.</p>
        ) : (
          <div className="space-y-3">
            {schedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                busy={busy}
                onDelete={() => void deleteSchedule(schedule.id, schedule.name)}
                onEdit={() => {
                  setEditingId(schedule.id);
                  setCreating(false);
                }}
                onRun={() => void runNow(schedule.id)}
                onToggleEnabled={() =>
                  void updateSchedule(schedule.id, { enabled: !schedule.enabled })
                }
              />
            ))}
          </div>
        )}

        {creating ? (
          <div className="rounded-2xl border border-border bg-surface-elevated p-4">
            <h3 className="mb-4 text-sm font-medium text-foreground">New schedule</h3>
            <ScheduleForm
              busy={busy}
              submitLabel="Create schedule"
              onCancel={() => setCreating(false)}
              onSubmit={async (input) => {
                const created = await createSchedule(input);
                if (created) {
                  setCreating(false);
                }
              }}
            />
          </div>
        ) : null}

        {editing ? (
          <div className="rounded-2xl border border-border bg-surface-elevated p-4">
            <h3 className="mb-4 text-sm font-medium text-foreground">Edit {editing.name}</h3>
            <ScheduleForm
              busy={busy}
              initial={editing}
              submitLabel="Save changes"
              onCancel={() => setEditingId(null)}
              onSubmit={async (input) => {
                const updated = await updateSchedule(editing.id, input);
                if (updated) {
                  setEditingId(null);
                }
              }}
            />
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border-t border-border pt-8">
        <h2 className="text-base font-medium text-foreground">Run history</h2>
        {loading ? (
          <p className="text-sm text-foreground-muted">Loading runs...</p>
        ) : (
          <RunList runs={runs} onReload={reload} />
        )}
      </section>
    </div>
  );
}

function ScheduleCard({
  schedule,
  busy,
  onDelete,
  onEdit,
  onRun,
  onToggleEnabled,
}: {
  schedule: AutomationSchedule;
  busy: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onRun: () => void;
  onToggleEnabled: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-elevated p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{schedule.name}</h3>
            <Badge variant={schedule.enabled ? 'success' : 'neutral'} className="font-normal">
              {schedule.enabled ? 'Enabled' : 'Paused'}
            </Badge>
          </div>
          <p className="line-clamp-2 text-sm text-foreground">{schedule.prompt}</p>
          <p className="text-xs text-foreground-muted">
            {describeTiming(schedule.cron, schedule.timezone)}
            {schedule.nextRunAt
              ? ` · next ${new Date(schedule.nextRunAt).toLocaleString()}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRun} disabled={busy}>
            Run now
          </Button>
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy}>
            Edit
          </Button>
          <Button size="sm" variant="secondary" onClick={onToggleEnabled} disabled={busy}>
            {schedule.enabled ? 'Pause' : 'Enable'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Delete "${schedule.name}"? Its run history will be deleted too.`,
                )
              ) {
                onDelete();
              }
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
