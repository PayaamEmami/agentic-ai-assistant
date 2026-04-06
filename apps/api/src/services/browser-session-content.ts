import type { McpBrowserSession } from '@aaa/db';

export function buildBrowserSessionContentBlock(
  session: Pick<
    McpBrowserSession,
    'id' | 'mcpConnectionId' | 'purpose' | 'status' | 'expiresAt' | 'endedAt'
  >,
  input?: {
    instanceLabel?: string;
  },
) {
  return {
    type: 'browser_session' as const,
    browserSessionId: session.id,
    mcpConnectionId: session.mcpConnectionId,
    purpose: session.purpose,
    status: session.status,
    instanceLabel: input?.instanceLabel,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

export function buildBrowserSessionContentPatch(
  session: Pick<McpBrowserSession, 'status' | 'expiresAt' | 'endedAt'>,
) {
  return {
    status: session.status,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}
