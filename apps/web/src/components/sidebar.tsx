'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDownIcon, EditIcon, MoreIcon, PlusIcon, SidebarToggleIcon, TrashIcon } from '@/components/icons';
import { AccountMenu } from '@/components/sidebar/account-menu';
import { IconButton } from '@/components/ui/icon-button';
import { useChatContext } from '@/lib/chat-context';
import { useAuthContext } from '@/lib/auth-context';
import { useDismissOnOutsidePointerDown } from '@/lib/use-dismiss-on-outside-pointer-down';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleDesktopCollapse?: () => void;
}

function conversationLabel(title: string | null) {
  return title?.trim() || 'Untitled conversation';
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
  const [isConversationListCollapsed, setIsConversationListCollapsed] = useState(false);
  const [mobileActionMenuConversationId, setMobileActionMenuConversationId] = useState<
    string | null
  >(null);
  const longPressTimerRef = useRef<number | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const isPersonalizationPage = pathname === '/chat/personalization';
  const isAppsPage = pathname === '/chat/apps';

  useEffect(() => {
    setIsAccountMenuOpen(false);
  }, [pathname]);

  useDismissOnOutsidePointerDown(accountMenuRef, isAccountMenuOpen, () => setIsAccountMenuOpen(false));

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
    setMobileActionMenuConversationId(null);
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
      setMobileActionMenuConversationId(null);
      await deleteConversation(conversationId);
    } finally {
      setPendingConversationId(null);
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) {
      return;
    }

    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  useEffect(() => clearLongPressTimer, []);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex min-h-0 w-72 shrink-0 flex-col border-r border-border bg-surface transition-transform duration-200 md:static md:translate-x-0 ${
        isAccountMenuOpen ? 'overflow-visible md:z-50' : 'overflow-hidden md:z-20'
      } ${collapsed ? 'md:w-20' : 'md:w-72'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className={`border-b border-border ${collapsed ? 'p-2' : 'p-4'}`}>
        <div
          className={`flex items-center gap-2 ${collapsed ? 'justify-center' : 'justify-between'}`}
        >
          {collapsed ? null : (
            <button
              type="button"
              onClick={() => setIsConversationListCollapsed((previous) => !previous)}
              className="inline-flex items-center gap-2 rounded-xl px-2 py-2 text-sm font-semibold text-foreground transition hover:bg-surface-hover"
              aria-label={
                isConversationListCollapsed ? 'Expand conversations' : 'Collapse conversations'
              }
              title={
                isConversationListCollapsed ? 'Expand conversations' : 'Collapse conversations'
              }
            >
              <span>Conversations</span>
              <ChevronDownIcon collapsed={isConversationListCollapsed} />
            </button>
          )}
          <div className="flex items-center gap-2">
            {!collapsed ? (
              <IconButton
                onClick={() => void openChat(undefined)}
                title="New conversation"
                aria-label="New conversation"
              >
                <PlusIcon />
              </IconButton>
            ) : null}
            <IconButton
              onClick={onToggleDesktopCollapse ?? onCloseMobile}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <SidebarToggleIcon />
            </IconButton>
          </div>
        </div>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {collapsed || isConversationListCollapsed ? null : loading.isLoadingConversations &&
          conversations.length === 0 ? (
          <p
            className="p-2 text-sm text-foreground-muted"
          >
            Loading conversations...
          </p>
        ) : conversations.length === 0 ? (
          <p className="p-2 text-sm text-foreground-muted">No conversations yet</p>
        ) : (
          conversations.map((conversation) => {
            const isActive = currentConversationId === conversation.id;
            const isEditing = editingConversationId === conversation.id;
            const isPending = pendingConversationId === conversation.id;
            const label = conversationLabel(conversation.title);

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
                  <div className="group relative flex items-center gap-2">
                    <button
                      onClick={() => void openChat(conversation.id)}
                      onPointerDown={(event) => {
                        if (event.pointerType !== 'touch') {
                          return;
                        }

                        clearLongPressTimer();
                        longPressTimerRef.current = window.setTimeout(() => {
                          setMobileActionMenuConversationId(conversation.id);
                        }, 450);
                      }}
                      onPointerUp={clearLongPressTimer}
                      onPointerLeave={clearLongPressTimer}
                      onPointerCancel={clearLongPressTimer}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMobileActionMenuConversationId(conversation.id);
                      }}
                      className="min-w-0 flex-1 touch-manipulation select-none text-left"
                      disabled={isPending}
                    >
                      <p className="truncate">{label}</p>
                    </button>
                    <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconButton
                        size="sm"
                        onClick={() => startEditing(conversation.id, conversation.title)}
                        disabled={isPending}
                        className="h-auto w-auto rounded p-1 hover:bg-surface"
                        title="Rename conversation"
                        aria-label="Rename conversation"
                      >
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="sm"
                        variant="danger"
                        onClick={() => void handleDelete(conversation.id, conversation.title)}
                        disabled={isPending}
                        className="h-auto w-auto rounded p-1 hover:bg-surface"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <TrashIcon />
                      </IconButton>
                    </div>
                    <IconButton
                      size="sm"
                      onClick={() =>
                        setMobileActionMenuConversationId((previous) =>
                          previous === conversation.id ? null : conversation.id,
                        )
                      }
                      disabled={isPending}
                      className="h-auto w-auto rounded p-1 hover:bg-surface md:hidden"
                      title="Conversation actions"
                      aria-label="Conversation actions"
                    >
                      <MoreIcon />
                    </IconButton>
                    {mobileActionMenuConversationId === conversation.id ? (
                      <div className="absolute right-0 top-full z-20 mt-1 flex w-40 flex-col rounded-xl border border-border bg-surface-elevated p-1 shadow-lg md:hidden">
                        <button
                          type="button"
                          onClick={() => startEditing(conversation.id, conversation.title)}
                          disabled={isPending}
                          className="rounded-lg px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(conversation.id, conversation.title)}
                          disabled={isPending}
                          className="rounded-lg px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-error disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })
        )}
      </nav>
      <AccountMenu
        collapsed={collapsed}
        isAppsPage={isAppsPage}
        isOpen={isAccountMenuOpen}
        isPersonalizationPage={isPersonalizationPage}
        menuRef={accountMenuRef}
        onLogout={handleLogout}
        onNavigate={navigateTo}
        onToggleOpen={() => setIsAccountMenuOpen((previous) => !previous)}
        user={user}
      />
    </aside>
  );
}
