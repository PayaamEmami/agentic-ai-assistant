import { ChatPanel } from '@/components/chat-panel';
import { InputBar } from '@/components/input-bar';

export default function ChatPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ChatPanel />
      <InputBar />
    </div>
  );
}
