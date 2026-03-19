'use client';

import { useChatContext } from '@/lib/chat-context';
import { CitationCard } from './citation-card';
import { ToolActivity } from './tool-activity';
import { ApprovalCard } from './approval-card';
import { ConnectorManager } from './connector-manager';

export function RightPanel() {
  const { pendingApprovals, toolActivities, citations, loading } = useChatContext();

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-surface">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Connectors">
          <ConnectorManager />
        </Section>
        <Section title="Approvals">
          {loading.isLoadingApprovals && pendingApprovals.length === 0 ? (
            <p className="text-xs text-foreground-muted">Loading approvals...</p>
          ) : pendingApprovals.length === 0 ? (
            <p className="text-xs text-foreground-muted">No pending approvals</p>
          ) : (
            pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                id={approval.id}
                description={approval.description}
              />
            ))
          )}
        </Section>
        <Section title="Tool Activity">
          {toolActivities.length === 0 ? (
            <p className="text-xs text-foreground-muted">No tool activity yet</p>
          ) : (
            toolActivities.map((activity) => (
              <ToolActivity key={activity.id} name={activity.name} status={activity.status} />
            ))
          )}
        </Section>
        <Section title="Sources">
          {citations.length === 0 ? (
            <p className="text-xs text-foreground-muted">No sources yet</p>
          ) : (
            citations.map((citation) => (
              <CitationCard
                key={citation.id}
                title={citation.title}
                excerpt={citation.excerpt}
                uri={citation.uri}
              />
            ))
          )}
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
