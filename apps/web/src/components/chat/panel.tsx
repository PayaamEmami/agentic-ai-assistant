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
      <div ref={scrollRef} />
    </div>
  );
}
