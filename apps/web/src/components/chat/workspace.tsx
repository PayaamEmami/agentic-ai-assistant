'use client';

import { MessageList } from './message-list';
import { InputBar } from './input-bar';

export function ChatWorkspace() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <MessageList />
      <InputBar />
    </div>
  );
}
