'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { type AppSummary } from '@/lib/api-client';
import { useDismissOnOutsidePointerDown } from '@/lib/use-dismiss-on-outside-pointer-down';
import { formatTimestamp, indexedSourcesLabel } from './app-manager-labels';

export function IndexedSourcesSection({ app }: { app: AppSummary }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const sourcesId = `${app.kind}-indexed-sources`;
  const close = useCallback(() => setOpen(false), []);
  const filteredSources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return app.knowledge.recentSources;
    }

    return app.knowledge.recentSources.filter((source) =>
      source.title.toLowerCase().includes(normalizedQuery),
    );
  }, [app.knowledge.recentSources, query]);

  useDismissOnOutsidePointerDown(containerRef, open, close);

  return (
    <div ref={containerRef} className="relative mt-5 min-w-0">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={sourcesId}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover hover:text-foreground"
      >
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium text-foreground">
            Indexed Sources
          </span>
          <span className="mt-1 block text-xs text-foreground-muted">
            {indexedSourcesLabel(app.knowledge.searchableSourceCount)}
          </span>
        </span>
        <ChevronDownIcon />
      </button>

      {open ? (
        <div
          id={sourcesId}
          className="absolute right-0 z-20 mt-2 w-full rounded-2xl border border-border bg-surface-elevated p-3 shadow-lg"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search indexed sources"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none placeholder:text-foreground-inactive focus:border-accent"
          />
          {app.knowledge.recentSources.length === 0 ? (
            <p className="py-4 text-xs text-foreground-muted">No indexed sources yet.</p>
          ) : filteredSources.length === 0 ? (
            <p className="py-4 text-xs text-foreground-muted">
              No indexed sources match this search.
            </p>
          ) : (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
              {filteredSources.map((source) => (
                <div
                  key={source.id}
                  className="min-w-0 rounded-xl px-3 py-2 text-xs text-foreground-muted transition hover:bg-surface-hover hover:text-foreground"
                >
                  <p className="break-words font-medium text-foreground">{source.title}</p>
                  <p className="mt-1 text-foreground-muted">{formatTimestamp(source.updatedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
