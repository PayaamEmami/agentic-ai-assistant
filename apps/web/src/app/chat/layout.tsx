import { Sidebar } from '@/components/sidebar';
import { RightPanel } from '@/components/right-panel';
import { ChatProvider } from '@/lib/chat-context';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex flex-1 flex-col">{children}</main>
        <RightPanel />
      </div>
    </ChatProvider>
  );
}
