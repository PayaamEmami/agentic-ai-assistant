'use client';

import { useChatContext } from '@/lib/chat-context';
import { CitationCard } from './citation-card';
import { ToolActivity } from './tool-activity';
import { ApprovalCard } from './approval-card';
import { ConnectorManager } from './connector-manager';

export function RightPanel() {
  const { pendingApprovals, toolActivities, citations, loading } = useChatContext();

  return (
    <aside className="flex w-80 flex-col border-l border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold">Activity</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Connectors">
          <ConnectorManager />
        </Section>
        <Section title="Approvals">
          {loading.isLoadingApprovals && pendingApprovals.length === 0 ? (
            <p className="text-xs text-gray-400">Loading approvals...</p>
          ) : pendingApprovals.length === 0 ? (
            <p className="text-xs text-gray-400">No pending approvals</p>
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
            <p className="text-xs text-gray-400">No tool activity yet</p>
          ) : (
            toolActivities.map((activity) => (
              <ToolActivity key={activity.id} name={activity.name} status={activity.status} />
            ))
          )}
        </Section>
        <Section title="Sources">
          {citations.length === 0 ? (
            <p className="text-xs text-gray-400">No sources yet</p>
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
    <div className="border-b border-gray-100 p-4">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
