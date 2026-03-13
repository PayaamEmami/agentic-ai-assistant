interface ToolActivityProps {
  name: string;
  status: 'planned' | 'pending' | 'running' | 'completed' | 'failed';
}

export function ToolActivity({ name, status }: ToolActivityProps) {
  const statusColors: Record<string, string> = {
    planned: 'bg-blue-100 text-blue-700',
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<string, string> = {
    planned: 'Planned by model',
    pending: 'Waiting',
    running: 'Running now',
    completed: 'Completed',
    failed: 'Failed',
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
      <span className="text-sm">{name}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status] ?? ''}`}>
        {statusLabels[status] ?? status}
      </span>
    </div>
  );
}
