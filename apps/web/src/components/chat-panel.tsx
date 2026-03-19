'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/lib/chat-context';
import { Message } from './message';

export function ChatPanel() {
  const { messages, loading } = useChatContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading.isSendingMessage]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {loading.isLoadingMessages && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-foreground-muted">Loading conversation...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center h-full">
          <p className="text-foreground-muted">Start a conversation</p>
        </div>
      ) : (
        messages.map((message) => (
          <Message key={message.id} role={message.role} content={message.content} />
        ))
      )}
      {loading.isSendingMessage && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground-muted">
            Assistant is thinking...
          </div>
        </div>
      )}
      <div ref={scrollRef} />
    </div>
  );
}
