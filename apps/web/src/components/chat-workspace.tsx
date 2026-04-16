'use client';

import { ChatPanel } from './chat-panel';
import { InputBar } from './input-bar';

export function ChatWorkspace() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <ChatPanel />
      <InputBar />
    </div>
  );
}
