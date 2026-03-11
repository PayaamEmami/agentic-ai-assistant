'use client';

import { CitationCard } from './citation-card';
import { ToolActivity } from './tool-activity';
import { ApprovalCard } from './approval-card';

export function RightPanel() {
  // TODO: populate from conversation state

  return (
    <aside className="flex w-80 flex-col border-l border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <h2 className="text-sm font-semibold">Activity</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Approvals">
          {/* TODO: render pending approvals */}
          <ApprovalCard id="example" description="Example approval" onDecide={() => {}} />
        </Section>
        <Section title="Tool Activity">
          {/* TODO: render tool executions */}
          <ToolActivity name="Example Tool" status="completed" />
        </Section>
        <Section title="Sources">
          {/* TODO: render citations */}
          <CitationCard title="Example Source" excerpt="Example excerpt text..." />
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
