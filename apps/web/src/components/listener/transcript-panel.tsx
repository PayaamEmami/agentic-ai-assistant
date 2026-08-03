'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ListenerPhase, ListenerTranscriptSegment } from '@/lib/listener';
import { selectionInside } from '@/lib/listener/selection';

interface TranscriptPanelProps {
  segments: ListenerTranscriptSegment[];
  phase: ListenerPhase;
  isExplaining: boolean;
  onExplain: (selectedText: string) => Promise<void>;
}

export function TranscriptPanel({
  segments,
  phase,
  isExplaining,
  onExplain,
}: TranscriptPanelProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const transcript = useMemo(
    () => segments.map((segment) => segment.text).join('\n').trim(),
    [segments],
  );

  const captureSelection = () => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    setSelectedText(selectionInside(root, window.getSelection()));
  };

  const copyTranscript = async () => {
    if (transcript) {
      await navigator.clipboard.writeText(transcript);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface-elevated">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Live transcript</h2>
          <p className="text-xs text-foreground-muted">
            {phase === 'listening' ? 'Listening now' : 'Select text to explain it'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyTranscript()}
          disabled={!transcript}
          className="text-xs font-medium text-foreground-muted transition hover:text-foreground disabled:opacity-40"
        >
          Copy
        </button>
      </header>
      <div
        ref={rootRef}
        onPointerUp={captureSelection}
        onKeyUp={captureSelection}
        className="min-h-0 flex-1 select-text overflow-y-auto px-5 py-5"
      >
        {segments.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center text-center">
            <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">
              Start listening and the transcript will appear here. Audio is transcribed live;
              raw audio is not saved.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-[15px] leading-7 text-foreground">
            {segments.map((segment) => (
              <p
                key={segment.itemId}
                className={segment.final ? undefined : 'text-foreground-muted'}
              >
                {segment.text}
              </p>
            ))}
          </div>
        )}
      </div>
      {selectedText ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-foreground-muted">
              “{selectedText}”
            </p>
            <Button
              size="sm"
              disabled={isExplaining}
              onClick={() => {
                void onExplain(selectedText).then(() => {
                  setSelectedText('');
                  window.getSelection()?.removeAllRanges();
                });
              }}
            >
              {isExplaining ? 'Explaining…' : 'Explain'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
