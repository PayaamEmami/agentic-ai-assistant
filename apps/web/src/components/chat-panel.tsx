'use client';

import { useEffect, useRef } from 'react';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';
import { Message } from './message';
import { ToolActivity } from './tool-activity';

function getFirstName(displayName: string | undefined) {
  const normalized = displayName?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.split(/\s+/)[0] || null;
}

export function ChatPanel() {
  const { messages, toolActivities, loading } = useChatContext();
  const { user } = useAuthContext();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstName = getFirstName(user?.displayName);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading.isSendingMessage, loading.isInterruptingMessage]);

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
      {loading.isSendingMessage && (
        <div className="flex justify-start">
          <div className="max-w-[70%] rounded-lg border border-border bg-surface-overlay px-4 py-2 text-sm text-foreground-muted">
            {loading.isInterruptingMessage ? 'Stopping response...' : 'Assistant is thinking...'}
          </div>
        </div>
      )}
      {toolActivities
        .filter((activity) => activity.status === 'planned' || activity.status === 'running')
        .map((activity) => (
          <ToolActivity
            key={activity.id}
            name={activity.name}
            status={activity.status}
            detail={activity.detail}
          />
        ))}
      <div ref={scrollRef} />
    </div>
  );
}
