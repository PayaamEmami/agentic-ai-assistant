'use client';

import { useChatContext } from '@/lib/chat';
import { Button } from '@/components/ui/button';

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
        <Button size="sm" variant="success" onClick={() => void approveAction(id)}>
          Approve
        </Button>
        <Button size="sm" variant="danger" onClick={() => void rejectAction(id)}>
          Reject
        </Button>
      </div>
    </div>
  );
}
