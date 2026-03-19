'use client';

import { useChatContext } from '@/lib/chat-context';

interface ApprovalCardProps {
  id: string;
  description: string;
}

export function ApprovalCard({ id, description }: ApprovalCardProps) {
  const { approveAction, rejectAction } = useChatContext();

  return (
    <div className="rounded-lg border border-warning bg-warning/10 p-3">
      <p className="text-sm text-foreground">{description}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void approveAction(id)}
          className="rounded bg-success px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          Approve
        </button>
        <button
          onClick={() => void rejectAction(id)}
          className="rounded bg-error px-3 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
