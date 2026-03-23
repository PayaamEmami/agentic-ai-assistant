'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthContext();
  const {
    conversations,
    currentConversationId,
    loading,
    selectConversation,
    renameConversation,
    deleteConversation,
  } = useChatContext();
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const isMemoryPage = pathname === '/chat/memory';

  const handleLogout = () => {
    logout();
    router.replace('/');
  };

  const openChat = async (conversationId?: string) => {
    await selectConversation(conversationId);
    if (pathname !== '/chat') {
      router.push('/chat');
    }
  };

  const startEditing = (conversationId: string, title: string | null) => {
    setEditingConversationId(conversationId);
    setDraftTitle(title ?? '');
  };

  const cancelEditing = () => {
    setEditingConversationId(null);
    setDraftTitle('');
  };

  const handleRename = async (conversationId: string) => {
    const normalizedTitle = draftTitle.trim();
    if (!normalizedTitle) {
      cancelEditing();
      return;
    }

    setPendingConversationId(conversationId);
    try {
      await renameConversation(conversationId, normalizedTitle);
      cancelEditing();
    } finally {
      setPendingConversationId(null);
    }
  };

  const handleDelete = async (conversationId: string, title: string | null) => {
    const label = title?.trim() || 'Untitled conversation';
    const confirmed = window.confirm(`Delete "${label}"? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setPendingConversationId(conversationId);
    try {
      if (editingConversationId === conversationId) {
        cancelEditing();
      }
      await deleteConversation(conversationId);
    } finally {
      setPendingConversationId(null);
    }
  };

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
          <button
            onClick={() => void openChat(undefined)}
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
        <button
          onClick={() => router.push('/chat/memory')}
          className={`mt-3 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
            isMemoryPage
              ? 'bg-surface-accent text-foreground'
              : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          <MemoryIcon />
          Memory
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {loading.isLoadingConversations && conversations.length === 0 ? (
          <p className="p-2 text-sm text-foreground-muted">Loading conversations...</p>
        ) : conversations.length === 0 ? (
          <p className="p-2 text-sm text-foreground-muted">No conversations yet</p>
        ) : (
          conversations.map((conversation) => {
            const isActive = currentConversationId === conversation.id;
            const isEditing = editingConversationId === conversation.id;
            const isPending = pendingConversationId === conversation.id;
            return (
              <div
                key={conversation.id}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-surface-accent text-foreground'
                    : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
                }`}
              >
                {isEditing ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleRename(conversation.id);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          cancelEditing();
                        }
                      }}
                      autoFocus
                      disabled={isPending}
                      className="min-w-0 flex-1 rounded-md border border-border-subtle bg-surface px-2 py-1 text-sm text-foreground outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      disabled={isPending}
                      className="text-xs font-medium text-accent disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={isPending}
                      className="text-xs text-foreground-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="group flex items-center gap-2">
                    <button
                      onClick={() => void openChat(conversation.id)}
                      className="min-w-0 flex-1 text-left"
                      disabled={isPending}
                    >
                      <p className="truncate">{conversation.title ?? 'Untitled conversation'}</p>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEditing(conversation.id, conversation.title)}
                        disabled={isPending}
                        className="rounded p-1 text-foreground-muted hover:bg-surface hover:text-foreground disabled:opacity-50"
                        title="Rename conversation"
                        aria-label="Rename conversation"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(conversation.id, conversation.title)}
                        disabled={isPending}
                        className="rounded p-1 text-foreground-muted hover:bg-surface hover:text-error disabled:opacity-50"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                )}
              </div>
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

function MemoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5H8a2 2 0 0 0-2 2v10" />
      <path d="M12 5h4a2 2 0 0 1 2 2v10" />
      <path d="M8 17h8" />
      <path d="M8 21h8" />
      <path d="M12 5v16" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
