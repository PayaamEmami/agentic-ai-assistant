'use client';

import { useChatContext } from '@/lib/chat-context';

interface ApprovalCardProps {
  id: string;
  description: string;
}

export function ApprovalCard({ id, description }: ApprovalCardProps) {
  const { approveAction, rejectAction } = useChatContext();

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
      <p className="text-sm">{description}</p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void approveAction(id)}
          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500"
        >
          Approve
        </button>
        <button
          onClick={() => void rejectAction(id)}
          className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
