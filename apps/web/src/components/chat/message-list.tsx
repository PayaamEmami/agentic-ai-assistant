'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChatContext } from '@/lib/chat';
import { Message } from './message';
import { isPinnedToBottom } from './message-list-scroll';

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

export function MessageList() {
  const { messages, loading, currentConversationId } = useChatContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const [emptyChatPrompt, setEmptyChatPrompt] = useState(EMPTY_CHAT_PROMPTS[0]);
  const lastMessage = messages.at(-1);

  useEffect(() => {
    setEmptyChatPrompt(EMPTY_CHAT_PROMPTS[Math.floor(Math.random() * EMPTY_CHAT_PROMPTS.length)]);
  }, []);

  useLayoutEffect(() => {
    pinnedRef.current = true;
  }, [currentConversationId]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // A message the user just sent should land in view even if they had
    // scrolled up to read. Later updates follow only while they stay at the tail.
    if (lastMessage?.role === 'user') {
      pinnedRef.current = true;
    }
    if (!pinnedRef.current) {
      return;
    }

    programmaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [messages, currentConversationId, lastMessage?.id, lastMessage?.role]);

  const syncPinFromScroll = () => {
    if (programmaticScrollRef.current) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    pinnedRef.current = isPinnedToBottom(
      container.scrollTop,
      container.scrollHeight,
      container.clientHeight,
    );
  };

  return (
    <div
      ref={containerRef}
      onScroll={syncPinFromScroll}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 [overflow-anchor:none]"
    >
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
    </div>
  );
}
