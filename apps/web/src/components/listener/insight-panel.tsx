'use client';

import { Markdown } from '@/components/chat/message/markdown';
import type { ListenerInsight } from '@/lib/listener';

interface InsightPanelProps {
  insights: ListenerInsight[];
  isExplaining: boolean;
}

export function InsightPanel({ insights, isExplaining }: InsightPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-sm font-semibold text-foreground">Insights</h2>
        {isExplaining ? (
          <span className="text-xs font-medium text-accent">Thinking…</span>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        {insights.length === 0 ? (
          <div className="flex h-full min-h-0 flex-1 items-center justify-center text-center">
            <p className="max-w-xs text-sm leading-relaxed text-foreground-muted">
              Explanations will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {insights.map((insight, index) => (
              <article
                key={`${insight.title}-${index}`}
                className="rounded-2xl border border-border bg-surface-elevated p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{insight.title}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        `${insight.title}\n\n${insight.explanation}`,
                      )
                    }
                    className="text-xs text-foreground-muted transition hover:text-foreground"
                  >
                    Copy
                  </button>
                </div>
                <div className="text-sm text-foreground">
                  <Markdown>{insight.explanation}</Markdown>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
