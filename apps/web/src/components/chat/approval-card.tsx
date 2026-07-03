'use client';

import { useChatContext } from '@/lib/chat';

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
          className="rounded border border-success/60 bg-transparent px-3 py-1 text-xs font-medium text-success transition hover:border-success hover:bg-success/10"
        >
          Approve
        </button>
        <button
          onClick={() => void rejectAction(id)}
          className="rounded border border-error/60 bg-transparent px-3 py-1 text-xs font-medium text-error transition hover:border-error hover:bg-error/10"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
