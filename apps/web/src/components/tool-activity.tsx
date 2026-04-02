interface ToolActivityProps {
  name: string;
  status: 'planned' | 'pending' | 'running' | 'completed' | 'failed';
  detail?: string;
}

export function ToolActivity({ name, status, detail }: ToolActivityProps) {
  const statusColors: Record<string, string> = {
    planned: 'bg-accent/20 text-accent',
    pending: 'bg-surface-input text-foreground-muted',
    running: 'bg-warning/20 text-warning',
    completed: 'bg-success/20 text-success',
    failed: 'bg-error/20 text-error',
  };
  const statusLabels: Record<string, string> = {
    planned: 'Planned by model',
    pending: 'Waiting',
    running: 'Running now',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <div className="rounded-lg border border-border bg-surface-overlay p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground">{name}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status] ?? ''}`}>
          {statusLabels[status] ?? status}
        </span>
      </div>
      {detail ? <p className="mt-2 text-xs text-foreground-muted">{detail}</p> : null}
    </div>
  );
}
