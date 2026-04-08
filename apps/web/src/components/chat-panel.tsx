'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';
import { Message } from './message';

function getFirstName(displayName: string | undefined) {
  const normalized = displayName?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.split(/\s+/)[0] || null;
}

export function ChatPanel() {
  const { messages, loading } = useChatContext();
  const { user } = useAuthContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstName = getFirstName(user?.displayName);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading.isInterruptingMessage]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
      {loading.isLoadingMessages && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-foreground-muted">Loading conversation...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-foreground-muted">
            {firstName
              ? `What can I help you with, ${firstName}?`
              : 'What can I help you with today?'}
          </p>
        </div>
      ) : (
        messages.map((message) => (
          <Message key={message.id} role={message.role} content={message.content} />
        ))
      )}
      <div ref={scrollRef} />
    </div>
  );
}
