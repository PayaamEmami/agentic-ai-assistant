'use client';

import { useEffect, useRef, useState } from 'react';
import { useChatContext } from '@/lib/chat';
import { Message } from './message';

const EMPTY_CHAT_PROMPTS = [
  'What, mortal?',
  'What needs revealing?',
  'Thy bidding, master?',
  'What does the shadow will?',
  'What you want?',
  'Something need doing?',
  'Yes, warchief?',
  'Do you need my counsel?',
  'What would you ask of me?',
];

function ThinkingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-lg border border-border bg-surface-overlay px-4 py-3 text-sm text-foreground"
        aria-label="Agent is thinking"
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-flex gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-muted" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-muted [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-muted [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { messages, loading } = useChatContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [emptyChatPrompt, setEmptyChatPrompt] = useState(EMPTY_CHAT_PROMPTS[0]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading.isInterruptingMessage]);

  useEffect(() => {
    setEmptyChatPrompt(EMPTY_CHAT_PROMPTS[Math.floor(Math.random() * EMPTY_CHAT_PROMPTS.length)]);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {loading.isLoadingMessages && messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-foreground-muted">Loading conversation...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <p className="text-foreground-muted">{emptyChatPrompt}</p>
        </div>
      ) : (
        messages.map((message) => (
          <Message
            key={message.id}
            role={message.role}
            content={message.content}
            presentation={message.presentation}
          />
        ))
      )}
      {loading.isSendingMessage ? <ThinkingIndicator /> : null}
      <div ref={scrollRef} />
    </div>
  );
}
