'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleDesktopCollapse?: () => void;
}

function conversationLabel(title: string | null) {
  return title?.trim() || 'Untitled conversation';
}

function getInitials(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return 'U';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 1).toUpperCase();
  }

  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleDesktopCollapse,
}: SidebarProps) {
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
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isConversationListCollapsed, setIsConversationListCollapsed] =
    useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const isPersonalizationPage = pathname === '/chat/personalization';
  const isConnectorsPage = pathname === '/chat/connectors';

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setIsAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isAccountMenuOpen]);

  const handleLogout = () => {
    setIsAccountMenuOpen(false);
    onCloseMobile();
    logout();
    router.replace('/');
  };

  const openChat = async (conversationId?: string) => {
    await selectConversation(conversationId);
    onCloseMobile();
    if (pathname !== '/chat') {
      router.push('/chat');
    }
  };

  const navigateTo = (href: string) => {
    setIsAccountMenuOpen(false);
    onCloseMobile();
    router.push(href);
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
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 md:static md:translate-x-0 ${
        isAccountMenuOpen ? 'overflow-visible md:z-50' : 'overflow-hidden md:z-20'
      } ${
        collapsed ? 'md:w-20' : 'md:w-72'
      } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className={`border-b border-border ${collapsed ? 'p-2' : 'p-4'}`}>
        <div
          className={`flex items-center gap-2 ${
            collapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          {collapsed ? null : (
            <button
              type="button"
              onClick={() =>
                setIsConversationListCollapsed((previous) => !previous)
              }
              className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-hover"
              aria-label={
                isConversationListCollapsed
                  ? 'Expand conversations'
                  : 'Collapse conversations'
              }
              title={
                isConversationListCollapsed
                  ? 'Expand conversations'
                  : 'Collapse conversations'
              }
            >
              <span>Conversations</span>
              {isConversationListCollapsed ? (
                <ChevronLeftIcon />
              ) : (
                <ChevronDownIcon />
              )}
            </button>
          )}
          <div className="flex items-center gap-2">
            {!collapsed ? (
              <button
                type="button"
                onClick={() => void openChat(undefined)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border-subtle text-foreground-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground"
                title="New conversation"
                aria-label="New conversation"
              >
                <PlusIcon />
              </button>
            ) : null}
            <button
              type="button"
              onClick={
                collapsed
                  ? onToggleDesktopCollapse ?? onCloseMobile
                  : onToggleDesktopCollapse ?? onCloseMobile
              }
              className={`inline-flex items-center justify-center rounded-2xl border border-border-subtle text-foreground-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground ${
                collapsed ? 'h-11 w-11' : 'h-10 w-10'
              }`}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </button>
          </div>
        </div>
      </div>
      <nav className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? 'p-2' : 'p-2'}`}>
        {!collapsed && isConversationListCollapsed ? null : loading.isLoadingConversations &&
          conversations.length === 0 ? (
          <p
            className={`text-sm text-foreground-muted ${collapsed ? 'px-1 py-2 text-center text-xs' : 'p-2'}`}
          >
            Loading conversations...
          </p>
        ) : conversations.length === 0 ? (
          collapsed ? null : (
            <p className="p-2 text-sm text-foreground-muted">
              No conversations yet
            </p>
          )
        ) : (
          conversations.map((conversation) => {
            const isActive = currentConversationId === conversation.id;
            const isEditing = editingConversationId === conversation.id;
            const isPending = pendingConversationId === conversation.id;
            const label = conversationLabel(conversation.title);

            if (collapsed) {
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => void openChat(conversation.id)}
                  disabled={isPending}
                  title={label}
                  aria-label={label}
                  className={`mb-2 flex h-12 w-full items-center justify-center rounded-2xl border text-sm font-semibold transition ${
                    isActive
                      ? 'border-transparent bg-surface-accent text-foreground'
                      : 'border-transparent text-foreground-muted hover:border-border hover:bg-surface-hover hover:text-foreground'
                  } disabled:opacity-50`}
                >
                  {getInitials(label)}
                </button>
              );
            }

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
                      <p className="truncate">{label}</p>
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
      <div
        ref={accountMenuRef}
        className="relative flex min-h-[73px] shrink-0 items-center border-t border-border p-1"
      >
        {isAccountMenuOpen ? (
          <div
            className={`absolute bottom-full z-30 mb-2 rounded-2xl border border-border bg-surface-elevated p-2 shadow-lg ${
              collapsed ? 'left-2 w-64' : 'left-2 right-2'
            }`}
          >
            <button
              type="button"
              onClick={() => navigateTo('/chat/personalization')}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition ${
                isPersonalizationPage
                  ? 'bg-surface-accent text-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              <PersonalizationIcon />
              Personalization
            </button>
            <button
              type="button"
              onClick={() => navigateTo('/chat/connectors')}
              className={`mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition ${
                isConnectorsPage
                  ? 'bg-surface-accent text-foreground'
                  : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              <ConnectorIcon />
              Connectors
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-error"
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setIsAccountMenuOpen((previous) => !previous)}
          className={`flex w-full items-center rounded-2xl border border-transparent transition hover:border-border hover:bg-surface-hover ${
            collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-3'
          }`}
          title={user?.displayName ?? user?.email ?? 'Account'}
          aria-label="Open account menu"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-input text-sm font-semibold text-foreground">
            {getInitials(user?.displayName ?? user?.email)}
          </span>
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-foreground">
                  {user?.displayName ?? 'Signed in'}
                </span>
                <span className="block truncate text-xs text-foreground-muted">
                  {user?.email}
                </span>
              </span>
              <ChevronUpDownIcon open={isAccountMenuOpen} />
            </>
          )}
        </button>
      </div>
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

function PersonalizationIcon() {
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

function ConnectorIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8a3 3 0 1 0-6 0" />
      <path d="M12 17a5 5 0 0 0 5-5V8H7v4a5 5 0 0 0 5 5Z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function ChevronUpDownIcon({ open }: { open: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`}>
      <path d="m6 9 6-6 6 6" />
      <path d="m18 15-6 6-6-6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
