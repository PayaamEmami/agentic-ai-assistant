import { ApprovalQueue } from '@/components/approval-queue';
import { ChatPanel } from '@/components/chat-panel';
import { InputBar } from '@/components/input-bar';

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated">
      <ChatPanel />
      <ApprovalQueue />
      <InputBar />
    </div>
  );
}
