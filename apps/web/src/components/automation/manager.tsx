'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { McpConnectionSection } from '@/components/automation/mcp-connection';
import { RunList } from '@/components/automation/run-list';
import { ScheduleForm } from '@/components/automation/schedule-form';
import { describeCron } from '@/lib/automation/automation-status';
import { useAutomationSchedules } from '@/lib/automation/use-automation-schedules';
import { api, type AutomationBoard, type AutomationSchedule } from '@/lib/api-client';

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
  const [mcpConnected, setMcpConnected] = useState(false);
  const [boards, setBoards] = useState<AutomationBoard[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadBoards = useCallback(async () => {
    if (!mcpConnected) {
      setBoards([]);
      return;
    }

    try {
      const result = await api.automation.listBoards();
      setBoards(result.boards);
    } catch {
      setBoards([]);
    }
  }, [mcpConnected]);

  useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  const editing = schedules.find((schedule) => schedule.id === editingId) ?? null;

  return (
    <div className="space-y-10">
      <McpConnectionSection onConnectedChange={setMcpConnected} />

      <section className="space-y-4 border-t border-border pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-foreground">Schedules</h2>
            <p className="mt-1 max-w-2xl text-sm text-foreground-muted">
              On each fire the assistant reads the board, picks a card and repository, and
              opens a draft pull request. Start in dry-run until you like what it chooses.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            disabled={!mcpConnected || busy}
          >
            New schedule
          </Button>
        </div>

        {!mcpConnected ? (
          <Alert variant="warning">
            Connect the task board MCP server before creating a schedule.
          </Alert>
        ) : null}

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
                onRun={(dryRun) => void runNow(schedule.id, dryRun)}
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
              boards={boards}
              busy={busy}
              disabled={!mcpConnected}
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
              boards={boards}
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
  onRun: (dryRun?: boolean) => void;
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
            {schedule.dryRun ? (
              <Badge variant="warning" className="font-normal">
                Dry run
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-foreground-muted">
            {describeCron(schedule.cron, schedule.timezone)}
            {schedule.nextRunAt
              ? ` · next ${new Date(schedule.nextRunAt).toLocaleString()}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onRun()} disabled={busy}>
            {schedule.dryRun ? 'Run now (dry)' : 'Run now'}
          </Button>
          {!schedule.dryRun ? (
            <Button size="sm" variant="secondary" onClick={() => onRun(true)} disabled={busy}>
              Dry run
            </Button>
          ) : null}
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
