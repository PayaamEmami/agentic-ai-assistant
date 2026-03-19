'use client';

import { useRouter } from 'next/navigation';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';

export function Sidebar() {
  const router = useRouter();
  const { user, logout } = useAuthContext();
  const { conversations, currentConversationId, loading, selectConversation } = useChatContext();

  const handleLogout = () => {
    logout();
    router.replace('/');
  };

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          <button
            onClick={() => void selectConversation(undefined)}
            className="rounded p-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground"
            title="New conversation"
          >
            <PlusIcon />
          </button>
        </div>
        <div className="mt-4 rounded-2xl bg-surface-input px-3 py-3">
          <p className="truncate text-sm font-medium text-foreground">
            {user?.displayName ?? 'Signed in'}
          </p>
          <p className="truncate text-xs text-foreground-muted">{user?.email}</p>
          <button
            onClick={handleLogout}
            className="mt-3 text-xs font-medium text-foreground-muted underline underline-offset-4"
          >
            Sign out
          </button>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {loading.isLoadingConversations && conversations.length === 0 ? (
          <p className="p-2 text-sm text-foreground-muted">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="p-2 text-sm text-foreground-muted">No conversations yet</p>
        ) : (
          conversations.map((conversation) => {
            const isActive = currentConversationId === conversation.id;
            return (
              <button
                key={conversation.id}
                onClick={() => void selectConversation(conversation.id)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-surface-accent text-foreground'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                <p className="truncate">{conversation.title ?? 'Untitled conversation'}</p>
              </button>
            );
          })
        )}
      </nav>
    </aside>
  );
}

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
