'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { McpBrowserSessionSummary } from '@/lib/api-client';
import type { UseBrowserSessionResult } from '@/lib/use-browser-session';

export type ChatBrowserView = 'mini' | 'dock';

export interface ChatBrowserContextValue {
  activeSessionId: string | null;
  activeSession: McpBrowserSessionSummary | null;
  browserView: ChatBrowserView;
  browser: UseBrowserSessionResult | null;
  isSessionSelected: (sessionId?: string | null) => boolean;
  isSessionDocked: (sessionId?: string | null) => boolean;
  canRenderMiniPreview: (sessionId?: string | null) => boolean;
  showSessionMini: (sessionId: string) => void;
  openSessionDock: (sessionId: string) => void;
  openSessionFullscreen: (sessionId: string) => void;
  collapseToMini: (sessionId?: string | null) => void;
  clearSession: () => void;
}

const ChatBrowserContext = createContext<ChatBrowserContextValue | null>(null);

export function ChatBrowserProvider({
  value,
  children,
}: {
  value: ChatBrowserContextValue;
  children: ReactNode;
}) {
  return <ChatBrowserContext.Provider value={value}>{children}</ChatBrowserContext.Provider>;
}

export function useChatBrowserContext(): ChatBrowserContextValue | null {
  return useContext(ChatBrowserContext);
}
