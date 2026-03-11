interface ToolActivityProps {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export function ToolActivity({ name, status }: ToolActivityProps) {
  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    running: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
      <span className="text-sm">{name}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[status] ?? ''}`}>
        {status}
      </span>
    </div>
  );
}
