'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './sidebar';

const SIDEBAR_STORAGE_KEY = 'agentic-ai-assistant.sidebar-collapsed';
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

export function ChatShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isDesktop, setIsDesktop] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [hasLoadedSidebarPreference, setHasLoadedSidebarPreference] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncViewport = () => {
      setIsDesktop(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    setIsSidebarCollapsed(storedValue === 'true');
    setHasLoadedSidebarPreference(true);

    return () => {
      mediaQuery.removeEventListener('change', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedSidebarPreference) {
      return;
    }

    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, isSidebarCollapsed ? 'true' : 'false');
  }, [hasLoadedSidebarPreference, isSidebarCollapsed]);

  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  const handleToggleSidebar = () => {
    if (isDesktop) {
      setIsSidebarCollapsed((previous) => !previous);
      return;
    }

    setIsMobileSidebarOpen((previous) => !previous);
  };

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-surface">
      {!isDesktop && isMobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      ) : null}
      <Sidebar
        collapsed={isDesktop && isSidebarCollapsed}
        mobileOpen={!isDesktop && isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onToggleDesktopCollapse={
          isDesktop ? () => setIsSidebarCollapsed((previous) => !previous) : undefined
        }
      />
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!isDesktop && !isMobileSidebarOpen ? (
          <button
            type="button"
            onClick={handleToggleSidebar}
            className="absolute left-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border-subtle bg-surface text-foreground-muted transition hover:border-border hover:bg-surface-hover hover:text-foreground md:hidden"
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            <ChevronRightIcon />
          </button>
        ) : null}
        <main
          className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-elevated ${
            !isDesktop && !isMobileSidebarOpen ? 'pt-16 md:pt-0' : ''
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
