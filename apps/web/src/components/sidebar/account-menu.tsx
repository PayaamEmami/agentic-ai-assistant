'use client';

import { type RefObject } from 'react';
import { AppsIcon, PersonalizationIcon, SignOutIcon } from '@/components/icons';

interface SidebarUser {
  email?: string | null;
  displayName?: string | null;
}

interface AccountMenuProps {
  collapsed: boolean;
  isAppsPage: boolean;
  isOpen: boolean;
  isPersonalizationPage: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onNavigate: (href: string) => void;
  onToggleOpen: () => void;
  onLogout: () => void;
  user: SidebarUser | null;
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

export function AccountMenu({
  collapsed,
  isAppsPage,
  isOpen,
  isPersonalizationPage,
  menuRef,
  onNavigate,
  onToggleOpen,
  onLogout,
  user,
}: AccountMenuProps) {
  return (
    <div
      ref={menuRef}
      className="relative flex min-h-[73px] shrink-0 items-center border-t border-border p-1"
    >
      {isOpen ? (
        <div
          className={`absolute bottom-full z-30 mb-2 rounded-2xl border border-border bg-surface-elevated p-2 shadow-lg ${
            collapsed ? 'left-2 w-64' : 'left-2 right-2'
          }`}
        >
          <button
            type="button"
            onClick={() => onNavigate('/chat/personalization')}
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
            onClick={() => onNavigate('/chat/apps')}
            className={`mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition ${
              isAppsPage
                ? 'bg-surface-accent text-foreground'
                : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
            }`}
          >
            <AppsIcon />
            Apps
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-surface-hover hover:text-error"
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onToggleOpen}
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
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-medium text-foreground">
              {user?.displayName ?? 'Signed in'}
            </span>
            <span className="block truncate text-xs text-foreground-muted">{user?.email}</span>
          </span>
        )}
      </button>
    </div>
  );
}
