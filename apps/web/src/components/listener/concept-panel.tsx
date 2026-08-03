'use client';

import { Markdown } from '@/components/chat/message/markdown';
import type { ListenerConcept } from '@/lib/listener';

interface ConceptPanelProps {
  concepts: ListenerConcept[];
  isExplaining: boolean;
}

export function ConceptPanel({ concepts, isExplaining }: ConceptPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Concepts</h2>
          <p className="text-xs text-foreground-muted">Explanations stay silent</p>
        </div>
        {isExplaining ? (
          <span className="text-xs font-medium text-accent">Thinking…</span>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {concepts.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center text-center">
            <p className="max-w-xs text-sm leading-relaxed text-foreground-muted">
              Select a phrase in the transcript, or enable Auto explain to surface difficult
              concepts as you watch.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {concepts.map((concept, index) => (
              <article
                key={`${concept.title}-${index}`}
                className="rounded-2xl border border-border bg-surface-elevated p-4"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{concept.title}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        `${concept.title}\n\n${concept.explanation}`,
                      )
                    }
                    className="text-xs text-foreground-muted transition hover:text-foreground"
                  >
                    Copy
                  </button>
                </div>
                <div className="text-sm text-foreground">
                  <Markdown>{concept.explanation}</Markdown>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
