'use client';

import { useEffect, useRef } from 'react';
import type { AutomationRunEvent } from '@/lib/api-client';
import { cn } from '@/lib/cn';

interface RunActivityLogProps {
  events: AutomationRunEvent[];
  loading: boolean;
  live: boolean;
}

const KIND_STYLES: Record<AutomationRunEvent['kind'], string> = {
  stage: 'text-foreground',
  thought: 'text-foreground-muted italic',
  progress: 'text-foreground-muted',
  result: 'text-foreground',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function RunActivityLog({ events, loading, live }: RunActivityLogProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Follow the tail only while the run is producing new entries; auto-scrolling
    // a finished log would fight the user trying to read it from the top.
    if (live && events.length > 0) {
      endRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [events.length, live]);

  if (loading && events.length === 0) {
    return <p className="px-1 py-2 text-xs text-foreground-muted">Loading activity...</p>;
  }

  if (events.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-foreground-muted">
        {live ? 'Waiting for the first update...' : 'No activity was recorded for this run.'}
      </p>
    );
  }

  return (
    <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface-elevated p-3">
      <ol className="space-y-2">
        {events.map((event) => (
          <li key={event.seq} className="flex gap-3 text-xs">
            <span className="shrink-0 font-mono text-foreground-inactive">
              {formatTime(event.at)}
            </span>
            <span className={cn('min-w-0 whitespace-pre-wrap', KIND_STYLES[event.kind])}>
              {event.message}
            </span>
          </li>
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
