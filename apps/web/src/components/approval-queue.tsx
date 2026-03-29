'use client';

import { ApprovalCard } from './approval-card';
import { useChatContext } from '@/lib/chat-context';

export function ApprovalQueue() {
  const { loading, pendingApprovals } = useChatContext();

  if (loading.isLoadingApprovals && pendingApprovals.length === 0) {
    return (
      <section className="border-t border-border bg-surface px-4 py-3">
        <p className="text-sm text-foreground-muted">Loading approvals...</p>
      </section>
    );
  }

  if (pendingApprovals.length === 0) {
    return null;
  }

  return (
    <section className="border-t border-border bg-surface px-4 py-4">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Pending approvals</p>
          <p className="mt-1 text-xs text-foreground-muted">
            Review tool actions without leaving the conversation.
          </p>
        </div>
        {pendingApprovals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            id={approval.id}
            description={approval.description}
          />
        ))}
      </div>
    </section>
  );
}
