import { Sidebar } from '@/components/sidebar';
import { RightPanel } from '@/components/right-panel';
import { ChatAuthGate } from '@/components/chat-auth-gate';
import { ChatProvider } from '@/lib/chat-context';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatAuthGate>
      <ChatProvider>
        <div className="flex h-screen">
          <Sidebar />
          <main className="flex flex-1 flex-col bg-surface-elevated">{children}</main>
          <RightPanel />
        </div>
      </ChatProvider>
    </ChatAuthGate>
  );
}
