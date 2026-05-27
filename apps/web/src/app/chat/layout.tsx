import { ChatShell } from '@/components/layout/chat-shell';
import { ChatAuthGate } from '@/components/layout/chat-auth-gate';
import { ChatProvider } from '@/lib/chat';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatAuthGate>
      <ChatProvider>
        <ChatShell>{children}</ChatShell>
      </ChatProvider>
    </ChatAuthGate>
  );
}
