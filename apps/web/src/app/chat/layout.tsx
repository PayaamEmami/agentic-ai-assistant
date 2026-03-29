import { ChatShell } from '@/components/chat-shell';
import { ChatAuthGate } from '@/components/chat-auth-gate';
import { ChatProvider } from '@/lib/chat-context';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatAuthGate>
      <ChatProvider>
        <ChatShell>{children}</ChatShell>
      </ChatProvider>
    </ChatAuthGate>
  );
}
