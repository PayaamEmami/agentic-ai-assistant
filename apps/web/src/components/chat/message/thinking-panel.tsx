'use client';

import { useState } from 'react';
import type { AssistantStage, ThinkingContentBlock } from '@/lib/chat';

const STAGE_LABELS: Record<AssistantStage, string> = {
  routing: 'Routing the request',
  retrieving: 'Searching your knowledge',
  research: 'Researching',
  tool: 'Planning tools',
  coding: 'Working through code',
  answering: 'Writing the answer',
  verifying: 'Verifying the answer',
  done: 'Done',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as AssistantStage] ?? stage;
}

export function ThinkingPanel({
  block,
  activeStage,
  streaming,
  hasRenderedText,
}: {
  block?: ThinkingContentBlock;
  activeStage?: AssistantStage;
  streaming?: boolean;
  hasRenderedText?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const segments = block?.segments ?? [];
  const hasSegments = segments.length > 0;

  // Live stream: a single muted, borderless indicator. Once the answer is
  // flowing and there is nothing to reveal, drop it so it doesn't linger.
  if (streaming) {
    if (!hasSegments && hasRenderedText) {
      return null;
    }

    const label = activeStage && activeStage !== 'done' ? stageLabel(activeStage) : 'Thinking';

    return (
      <div className="space-y-1.5 text-foreground-muted">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          <span>{label}</span>
        </div>
        {hasSegments ? (
          <div className="space-y-1.5 text-xs leading-normal text-foreground-muted/80">
            {segments.map((segment, index) => (
              <p key={`${segment.stage}-${index}`} className="m-0 whitespace-pre-wrap">
                {segment.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Settled: only show the toggle when there were real thoughts to reveal.
  if (!hasSegments) {
    return null;
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="text-left text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
        aria-expanded={expanded}
      >
        Thoughts
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-border-subtle/80 px-0 pt-2">
          {segments.map((segment, index) => (
            <div key={`${segment.stage}-${index}`} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted/80">
                {stageLabel(segment.stage)}
              </p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">
                {segment.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
