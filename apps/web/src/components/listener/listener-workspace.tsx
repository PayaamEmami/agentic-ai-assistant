'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { useChatContext } from '@/lib/chat';
import { useListenerSession } from '@/lib/listener';
import { InsightPanel } from './insight-panel';
import { TranscriptPanel } from './transcript-panel';

export function ListenerWorkspace() {
  const { syncConversationState } = useChatContext();
  const listener = useListenerSession({ syncConversation: syncConversationState });
  const [mobilePanel, setMobilePanel] = useState<'transcript' | 'insights'>('transcript');
  const active = listener.phase === 'connecting' || listener.phase === 'listening';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <header className="shrink-0 border-b border-border bg-surface px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-foreground">Listener Mode</h1>
              <span
                className={`h-2 w-2 rounded-full ${
                  listener.phase === 'listening'
                    ? 'bg-success'
                    : listener.phase === 'connecting'
                      ? 'bg-warning'
                      : 'bg-foreground-inactive'
                }`}
              />
            </div>
            <p className="truncate text-xs text-foreground-muted">
              {listener.phase === 'listening'
                ? `Transcribing with ${listener.session?.model ?? 'OpenAI'}`
                : listener.phase === 'connecting'
                  ? 'Connecting transcription…'
                  : 'Listen, transcribe, and explain without interrupting playback'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!active ? (
              <div className="flex rounded-xl border border-border bg-surface-elevated p-1">
                <button
                  type="button"
                  onClick={() => listener.setSource('microphone')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    listener.source === 'microphone'
                      ? 'bg-surface-accent text-foreground'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                >
                  Microphone
                </button>
                {listener.support.browserTab ? (
                  <button
                    type="button"
                    onClick={() => listener.setSource('browser_tab')}
                    className={`hidden rounded-lg px-3 py-1.5 text-xs font-medium transition md:block ${
                      listener.source === 'browser_tab'
                        ? 'bg-surface-accent text-foreground'
                        : 'text-foreground-muted hover:text-foreground'
                    }`}
                  >
                    Browser tab
                  </button>
                ) : null}
              </div>
            ) : null}
            {active ? (
              <Button
                variant="danger"
                size="sm"
                disabled={listener.phase === 'connecting'}
                onClick={() => void listener.stop()}
              >
                Stop
              </Button>
            ) : (
              <>
                {listener.segments.length > 0 || listener.insights.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={listener.clear}>
                    Clear
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => void listener.start()}>
                  {listener.phase === 'error' ? 'Retry' : 'Start listening'}
                </Button>
              </>
            )}
          </div>
        </div>
        {listener.error ? <Alert className="mt-3">{listener.error}</Alert> : null}
        {listener.source === 'browser_tab' && !active ? (
          <p className="mt-2 text-xs text-foreground-muted">
            Select the video tab and enable “Share tab audio” in the browser dialog.
          </p>
        ) : null}
      </header>

      <div className="flex shrink-0 border-b border-border bg-surface md:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel('transcript')}
          className={`flex-1 px-4 py-3 text-xs font-medium ${
            mobilePanel === 'transcript'
              ? 'border-b-2 border-accent text-foreground'
              : 'text-foreground-muted'
          }`}
        >
          Transcript
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('insights')}
          className={`flex-1 px-4 py-3 text-xs font-medium ${
            mobilePanel === 'insights'
              ? 'border-b-2 border-accent text-foreground'
              : 'text-foreground-muted'
          }`}
        >
          Insights{listener.insights.length > 0 ? ` (${listener.insights.length})` : ''}
        </button>
      </div>

      <div className="hidden min-h-0 flex-1 grid-cols-2 divide-x divide-border md:grid">
        <TranscriptPanel
          segments={listener.segments}
          isExplaining={listener.isExplaining}
          onExplain={listener.explainSelection}
        />
        <InsightPanel insights={listener.insights} isExplaining={listener.isExplaining} />
      </div>
      <div className="flex min-h-0 flex-1 md:hidden">
        {mobilePanel === 'transcript' ? (
          <TranscriptPanel
            segments={listener.segments}
            isExplaining={listener.isExplaining}
            onExplain={listener.explainSelection}
          />
        ) : (
          <InsightPanel insights={listener.insights} isExplaining={listener.isExplaining} />
        )}
      </div>
    </div>
  );
}
