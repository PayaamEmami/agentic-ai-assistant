import type { McpBrowserSession } from '@aaa/db';

export function buildBrowserSessionContentBlock(
  session: Pick<
    McpBrowserSession,
    'id' | 'mcpProfileId' | 'purpose' | 'status' | 'expiresAt' | 'endedAt' | 'metadata'
  >,
  input?: {
    profileLabel?: string;
  },
) {
  const handoffReason =
    typeof session.metadata['handoffReason'] === 'string' ? session.metadata['handoffReason'] : null;
  const terminalReason =
    typeof session.metadata['terminalReason'] === 'string' ? session.metadata['terminalReason'] : null;

  return {
    type: 'browser_session' as const,
    browserSessionId: session.id,
    mcpProfileId: session.mcpProfileId,
    purpose: session.purpose,
    status: session.status,
    profileLabel: input?.profileLabel,
    handoffReason,
    terminalReason,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}

export function buildBrowserSessionContentPatch(
  session: Pick<McpBrowserSession, 'status' | 'expiresAt' | 'endedAt' | 'metadata'>,
) {
  const terminalReason =
    typeof session.metadata['terminalReason'] === 'string' ? session.metadata['terminalReason'] : null;

  return {
    status: session.status,
    terminalReason,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
  };
}
