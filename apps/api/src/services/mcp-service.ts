import {
  mcpBrowserSessionRepository,
  mcpConnectionRepository,
  messageRepository,
  type McpBrowserSession,
  type McpConnection,
} from '@aaa/db';
import { decryptCredentials, encryptCredentials } from '@aaa/knowledge-sources';
import { getMcpRuntime, type RuntimeMcpConnection } from '@aaa/mcp';
import { AppError } from '../lib/errors.js';
import {
  getApiInstanceId,
  getApiInternalBaseUrl,
  getInternalServiceSecret,
} from '../lib/internal-service.js';
import { getBrowserSessionManager } from './browser-session-manager.js';
import {
  buildBrowserSessionContentBlock,
  buildBrowserSessionContentPatch,
} from './browser-session-content.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const INSTANCE_UNREACHABLE_CODES = new Set([
  'MCP_BROWSER_SESSION_NOT_LIVE',
  'BROWSER_SESSION_NOT_LIVE',
  'MCP_BROWSER_SESSION_OWNER_UNREACHABLE',
]);

function hasCredentialMaterial(credentials: Record<string, unknown>): boolean {
  return Object.keys(credentials).length > 0;
}

function toRuntimeConnection(
  connection: McpConnection,
  credentials = decryptCredentials(connection.encryptedCredentials),
): RuntimeMcpConnection {
  return {
    id: connection.id,
    userId: connection.userId,
    integrationKind: connection.integrationKind as RuntimeMcpConnection['integrationKind'],
    instanceLabel: connection.instanceLabel,
    status: connection.status,
    settings: connection.settings,
    credentials,
  };
}

function toConnectionSummary(connection: McpConnection) {
  const credentials = decryptCredentials(connection.encryptedCredentials);
  return {
    id: connection.id,
    integrationKind: connection.integrationKind as 'playwright',
    instanceLabel: connection.instanceLabel,
    status: connection.status,
    hasCredentials: hasCredentialMaterial(credentials),
    lastError: connection.lastError,
    isDefaultActive: connection.isDefaultActive,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

function toBrowserSessionDto(session: McpBrowserSession) {
  return {
    id: session.id,
    userId: session.userId,
    mcpConnectionId: session.mcpConnectionId,
    messageId: session.messageId,
    purpose: session.purpose,
    status: session.status,
    conversationId: session.conversationId,
    toolExecutionId: session.toolExecutionId,
    selectedPageId: session.selectedPageId,
    metadata: session.metadata,
    lastClientSeenAt: session.lastClientSeenAt?.toISOString() ?? null,
    lastFrameAt: session.lastFrameAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

async function requireOwnedConnection(userId: string, connectionId: string): Promise<McpConnection> {
  const connection = await mcpConnectionRepository.findByIdForUser(connectionId, userId);
  if (!connection) {
    throw new AppError(404, 'MCP connection not found', 'MCP_CONNECTION_NOT_FOUND');
  }
  return connection;
}

async function requireOwnedBrowserSession(
  userId: string,
  sessionId: string,
): Promise<{ session: McpBrowserSession; connection: McpConnection }> {
  const session = await mcpBrowserSessionRepository.findById(sessionId);
  if (!session || session.userId !== userId) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  const connection = await mcpConnectionRepository.findById(session.mcpConnectionId);
  if (!connection || connection.userId !== userId) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  return { session, connection };
}

async function requireBrowserSession(
  sessionId: string,
): Promise<{ session: McpBrowserSession; connection: McpConnection }> {
  const session = await mcpBrowserSessionRepository.findById(sessionId);
  if (!session) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  const connection = await mcpConnectionRepository.findById(session.mcpConnectionId);
  if (!connection) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  return { session, connection };
}

function isOwnedByCurrentInstance(session: Pick<McpBrowserSession, 'ownerInstanceId'>): boolean {
  return (
    !session.ownerInstanceId ||
    session.ownerInstanceId === getApiInstanceId()
  );
}

function hasRemoteOwner(session: Pick<McpBrowserSession, 'ownerInstanceId' | 'ownerInstanceUrl'>): boolean {
  return !isOwnedByCurrentInstance(session) && Boolean(session.ownerInstanceUrl);
}

function buildInternalBrowserSessionUrl(
  ownerInstanceUrl: string,
  sessionId: string,
  suffix = '',
): string {
  const base = new URL(ownerInstanceUrl);
  const pathSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  base.pathname = `/api/mcp/internal/browser-sessions/${sessionId}${suffix ? pathSuffix : ''}`;
  return base.toString();
}

async function parseInternalProxyError(response: Response): Promise<AppError> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string };
  };

  return new AppError(
    response.status,
    body.error?.message ?? 'Internal browser session proxy failed',
    body.error?.code ?? 'INTERNAL_PROXY_FAILED',
  );
}

export class McpService {
  private readonly runtime = getMcpRuntime();
  private readonly browserSessionManager = getBrowserSessionManager();

  listCatalog() {
    return this.runtime.listCatalog();
  }

  async listConnections(userId: string) {
    const connections = await mcpConnectionRepository.listByUser(userId);
    return connections.map(toConnectionSummary);
  }

  async createConnection(
    userId: string,
    input: {
      integrationKind: 'playwright';
      instanceLabel: string;
      authMode?: 'manual_browser' | 'stored_secret';
      secretProfile?: Record<string, unknown>;
    },
  ) {
    const existing = await mcpConnectionRepository.listByUser(userId);
    const hasDefaultForKind = existing.some(
      (connection) =>
        connection.integrationKind === input.integrationKind && connection.isDefaultActive,
    );

    const credentials: Record<string, unknown> = {};
    if (input.secretProfile) {
      credentials['secretProfiles'] = { default: input.secretProfile };
    }

    const connection = await mcpConnectionRepository.create({
      userId,
      integrationKind: input.integrationKind,
      instanceLabel: input.instanceLabel,
      status: input.authMode === 'stored_secret' && input.secretProfile ? 'connected' : 'pending',
      encryptedCredentials: encryptCredentials(credentials),
      settings: {},
      isDefaultActive: !hasDefaultForKind,
    });

    return toConnectionSummary(connection);
  }

  async setDefaultConnection(userId: string, connectionId: string) {
    const connection = await mcpConnectionRepository.setDefaultActive(connectionId, userId);
    if (!connection) {
      throw new AppError(404, 'MCP connection not found', 'MCP_CONNECTION_NOT_FOUND');
    }

    return toConnectionSummary(connection);
  }

  async deleteConnection(userId: string, connectionId: string) {
    const connection = await requireOwnedConnection(userId, connectionId);
    const activeSession = await mcpBrowserSessionRepository.findActiveByConnection(connection.id);
    if (activeSession) {
      if (hasRemoteOwner(activeSession)) {
        try {
          await this.proxyBrowserSessionRequest(activeSession, {
            suffix: 'cancel',
            method: 'POST',
          });
        } catch {
          await this.markBrowserSessionAsCrashed(activeSession, 'owner_instance_unreachable');
        }
      } else if (this.browserSessionManager.hasLiveSession(activeSession.id)) {
        await this.browserSessionManager.cancelSession(activeSession.id, 'connection_deleted');
      }
    }

    const deleted = await mcpConnectionRepository.delete(connectionId, userId);
    if (!deleted) {
      throw new AppError(404, 'MCP connection not found', 'MCP_CONNECTION_NOT_FOUND');
    }

    if (connection.isDefaultActive) {
      const remaining = await mcpConnectionRepository.listByUser(userId);
      const replacement = remaining.find(
        (candidate) => candidate.integrationKind === connection.integrationKind,
      );
      if (replacement) {
        await mcpConnectionRepository.setDefaultActive(replacement.id, userId);
      }
    }

    await this.runtime.invalidateConnection(connectionId);
    return { ok: true as const };
  }

  async listBrowserSessions(userId: string) {
    const sessions = await mcpBrowserSessionRepository.listByUser(userId, {
      includeEnded: false,
      limit: 20,
    });
    return sessions.map(toBrowserSessionDto);
  }

  async listBrowserSessionsByFilter(
    userId: string,
    input?: {
      conversationId?: string;
      includeEnded?: boolean;
      limit?: number;
    },
  ) {
    const sessions = await mcpBrowserSessionRepository.listByUser(userId, {
      conversationId: input?.conversationId,
      includeEnded: input?.includeEnded ?? false,
      limit: input?.limit ?? 20,
    });
    return sessions.map(toBrowserSessionDto);
  }

  private async updateBrowserSessionMessage(
    session: Pick<
      McpBrowserSession,
      'id' | 'messageId' | 'status' | 'expiresAt' | 'endedAt'
    >,
  ) {
    if (!session.messageId) {
      return;
    }

    await messageRepository.updateBrowserSessionBlock(
      session.messageId,
      session.id,
      buildBrowserSessionContentPatch(session),
    );
  }

  private async markBrowserSessionAsCrashed(
    session: McpBrowserSession,
    reason: string,
  ): Promise<McpBrowserSession> {
    const updated =
      (await mcpBrowserSessionRepository.update(session.id, {
        status: 'crashed',
        endedAt: new Date(),
        metadata: {
          ...session.metadata,
          reason,
        },
      })) ?? session;
    await this.updateBrowserSessionMessage(updated);
    return updated;
  }

  private async createBrowserSessionMessage(
    session: McpBrowserSession,
    connection: McpConnection,
  ): Promise<McpBrowserSession> {
    if (!session.conversationId) {
      return session;
    }

    const message = await messageRepository.create(session.conversationId, 'assistant', [
      buildBrowserSessionContentBlock(session, {
        instanceLabel: connection.instanceLabel,
      }),
    ]);

    return (
      (await mcpBrowserSessionRepository.update(session.id, {
        messageId: message.id,
      })) ?? {
        ...session,
        messageId: message.id,
      }
    );
  }

  private async proxyBrowserSessionRequest<T>(
    session: Pick<McpBrowserSession, 'id' | 'ownerInstanceUrl'>,
    input?: {
      suffix?: string;
      method?: 'GET' | 'POST';
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    if (!session.ownerInstanceUrl) {
      throw new AppError(
        409,
        'Browser session owner is unavailable',
        'MCP_BROWSER_SESSION_OWNER_UNAVAILABLE',
      );
    }

    const response = await fetch(
      buildInternalBrowserSessionUrl(session.ownerInstanceUrl, session.id, input?.suffix),
      {
        method: input?.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          'x-internal-service-secret': getInternalServiceSecret(),
        },
        body: input?.body ? JSON.stringify(input.body) : undefined,
      },
    ).catch((error: unknown) => {
      throw new AppError(
        502,
        error instanceof Error ? error.message : 'Browser session owner is unavailable',
        'MCP_BROWSER_SESSION_OWNER_UNREACHABLE',
      );
    });

    if (!response.ok) {
      throw await parseInternalProxyError(response);
    }

    return response.json() as Promise<T>;
  }

  async createBrowserSession(
    userId: string,
    connectionId: string,
    input: {
      purpose: 'auth' | 'manual' | 'tool_takeover';
      conversationId?: string;
      toolExecutionId?: string;
    },
  ) {
    const connection = await requireOwnedConnection(userId, connectionId);
    const existing = await mcpBrowserSessionRepository.findActiveByConnection(connection.id);
    if (existing) {
      if (hasRemoteOwner(existing)) {
        try {
          return await this.proxyBrowserSessionRequest<{
            session: ReturnType<typeof toBrowserSessionDto>;
            pages: Array<{ id: string; url: string; title: string; isSelected: boolean }>;
          }>(existing);
        } catch (error) {
          const code = error instanceof AppError ? error.code : undefined;
          if (!code || !INSTANCE_UNREACHABLE_CODES.has(code)) {
            throw error;
          }
          await this.markBrowserSessionAsCrashed(existing, 'owner_instance_unreachable');
        }
      } else if (this.browserSessionManager.hasLiveSession(existing.id)) {
        const snapshot = await this.browserSessionManager.getSnapshot(existing.id);
        return {
          session: toBrowserSessionDto(existing),
          pages: snapshot.pages.map((page) => ({
            id: page.pageId,
            url: page.url,
            title: page.title,
            isSelected: page.isSelected,
          })),
        };
      } else {
        await this.markBrowserSessionAsCrashed(existing, 'live_session_not_present_on_api');
      }
    }

    let session = await mcpBrowserSessionRepository.create({
      userId,
      mcpConnectionId: connection.id,
      purpose: input.purpose,
      conversationId: input.conversationId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
      metadata: {},
      ownerInstanceId: getApiInstanceId(),
      ownerInstanceUrl: getApiInternalBaseUrl(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    session = await this.createBrowserSessionMessage(session, connection);

    try {
      const snapshot = await this.browserSessionManager.createSession(session, connection, {
        startUrl:
          input.purpose === 'auth'
            ? (typeof connection.settings['manualAuthStartUrl'] === 'string'
                ? connection.settings['manualAuthStartUrl']
                : undefined)
            : undefined,
      });

      const updatedSession = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
      await this.updateBrowserSessionMessage(updatedSession);
      return {
        session: toBrowserSessionDto(updatedSession),
        pages: snapshot.pages.map((page) => ({
          id: page.pageId,
          url: page.url,
          title: page.title,
          isSelected: page.isSelected,
        })),
      };
    } catch (error) {
      await this.markBrowserSessionAsCrashed(session, 'session_create_failed');
      throw error;
    }
  }

  async getBrowserSession(userId: string, sessionId: string) {
    const { session } = await requireOwnedBrowserSession(userId, sessionId);

    if (hasRemoteOwner(session)) {
      try {
        return await this.proxyBrowserSessionRequest<{
          session: ReturnType<typeof toBrowserSessionDto>;
          pages: Array<{ id: string; url: string; title: string; isSelected: boolean }>;
        }>(session);
      } catch (error) {
        const code = error instanceof AppError ? error.code : undefined;
        if (!code || !INSTANCE_UNREACHABLE_CODES.has(code)) {
          throw error;
        }
        const crashedSession = await this.markBrowserSessionAsCrashed(
          session,
          'owner_instance_unreachable',
        );
        return {
          session: toBrowserSessionDto(crashedSession),
          pages: [],
        };
      }
    }

    const result = await this.getBrowserSessionInternal(sessionId);
    const refreshed = (await mcpBrowserSessionRepository.findById(sessionId)) ?? session;
    await this.updateBrowserSessionMessage(refreshed);
    return result;
  }

  async getBrowserSessionInternal(sessionId: string) {
    const { session } = await requireBrowserSession(sessionId);
    if (
      !isOwnedByCurrentInstance(session) &&
      !this.browserSessionManager.hasLiveSession(session.id)
    ) {
      throw new AppError(
        409,
        'Browser session is not live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    if (session.status === 'pending' || session.status === 'active') {
      if (session.expiresAt.getTime() < Date.now()) {
        if (this.browserSessionManager.hasLiveSession(session.id)) {
          await this.browserSessionManager.expireSession(session.id, 'session_expired');
        } else {
          const expiredSession = await mcpBrowserSessionRepository.update(session.id, {
            status: 'expired',
            endedAt: new Date(),
          });
          if (expiredSession) {
            await this.updateBrowserSessionMessage(expiredSession);
          }
        }
      } else if (
        isOwnedByCurrentInstance(session) &&
        !this.browserSessionManager.hasLiveSession(session.id)
      ) {
        const crashedSession = await this.markBrowserSessionAsCrashed(
          session,
          'session_not_live_on_api',
        );
        return {
          session: toBrowserSessionDto(crashedSession),
          pages: [],
        };
      }
    }

    const refreshed = (await mcpBrowserSessionRepository.findById(sessionId)) ?? session;
    const pages = this.browserSessionManager.hasLiveSession(sessionId)
      ? (await this.browserSessionManager.getSnapshot(sessionId)).pages.map((page) => ({
          id: page.pageId,
          url: page.url,
          title: page.title,
          isSelected: page.isSelected,
        }))
      : [];

    return {
      session: toBrowserSessionDto(refreshed),
      pages,
    };
  }

  async persistBrowserSession(
    userId: string,
    sessionId: string,
    input: { persistAsDefault?: boolean },
  ) {
    const { session, connection } = await requireOwnedBrowserSession(userId, sessionId);
    if (hasRemoteOwner(session)) {
      return this.proxyBrowserSessionRequest<{
        session: ReturnType<typeof toBrowserSessionDto>;
        connection: ReturnType<typeof toConnectionSummary>;
        pages: Array<{ id: string; url: string; title: string; isSelected: boolean }>;
      }>(session, {
        suffix: 'persist',
        method: 'POST',
        body: input,
      });
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppError(409, 'Browser session has expired', 'MCP_BROWSER_SESSION_EXPIRED');
    }

    if (!this.browserSessionManager.hasLiveSession(session.id)) {
      throw new AppError(
        409,
        'Browser session is no longer live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    const storageState = await this.browserSessionManager.persistSession(session.id);
    const currentCredentials = decryptCredentials(connection.encryptedCredentials);
    const updatedConnection = await mcpConnectionRepository.update(connection.id, {
      status: 'connected',
      encryptedCredentials: encryptCredentials({
        ...currentCredentials,
        storageState,
      }),
      lastError: null,
      isDefaultActive: input.persistAsDefault ? true : connection.isDefaultActive,
    });

    if (input.persistAsDefault) {
      await mcpConnectionRepository.setDefaultActive(connection.id, userId);
    }

    const updatedSession = await mcpBrowserSessionRepository.findById(session.id);
    if (updatedSession) {
      await this.updateBrowserSessionMessage(updatedSession);
    }
    return {
      session: toBrowserSessionDto(updatedSession ?? session),
      connection: toConnectionSummary(updatedConnection ?? connection),
      pages: [],
    };
  }

  async persistBrowserSessionInternal(
    sessionId: string,
    input: { persistAsDefault?: boolean },
  ) {
    const { session, connection } = await requireBrowserSession(sessionId);
    if (
      !isOwnedByCurrentInstance(session) &&
      !this.browserSessionManager.hasLiveSession(session.id)
    ) {
      throw new AppError(
        409,
        'Browser session is not live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    if (session.expiresAt.getTime() < Date.now()) {
      throw new AppError(409, 'Browser session has expired', 'MCP_BROWSER_SESSION_EXPIRED');
    }

    if (!this.browserSessionManager.hasLiveSession(session.id)) {
      throw new AppError(
        409,
        'Browser session is no longer live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    const storageState = await this.browserSessionManager.persistSession(session.id);
    const currentCredentials = decryptCredentials(connection.encryptedCredentials);
    const updatedConnection = await mcpConnectionRepository.update(connection.id, {
      status: 'connected',
      encryptedCredentials: encryptCredentials({
        ...currentCredentials,
        storageState,
      }),
      lastError: null,
      isDefaultActive: input.persistAsDefault ? true : connection.isDefaultActive,
    });

    if (input.persistAsDefault) {
      await mcpConnectionRepository.setDefaultActive(connection.id, session.userId);
    }

    const updatedSession = await mcpBrowserSessionRepository.findById(session.id);
    if (updatedSession) {
      await this.updateBrowserSessionMessage(updatedSession);
    }

    return {
      session: toBrowserSessionDto(updatedSession ?? session),
      connection: toConnectionSummary(updatedConnection ?? connection),
      pages: [],
    };
  }

  async cancelBrowserSession(userId: string, sessionId: string) {
    const { session } = await requireOwnedBrowserSession(userId, sessionId);
    if (hasRemoteOwner(session)) {
      return this.proxyBrowserSessionRequest<{ ok: true; session: ReturnType<typeof toBrowserSessionDto> }>(
        session,
        {
          suffix: 'cancel',
          method: 'POST',
        },
      );
    }

    if (this.browserSessionManager.hasLiveSession(session.id)) {
      await this.browserSessionManager.cancelSession(session.id);
    } else {
      const updatedSession = await mcpBrowserSessionRepository.update(session.id, {
        status: 'cancelled',
        endedAt: new Date(),
      });
      if (updatedSession) {
        await this.updateBrowserSessionMessage(updatedSession);
      }
    }

    const updated = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
    await this.updateBrowserSessionMessage(updated);
    return {
      ok: true as const,
      session: toBrowserSessionDto(updated),
    };
  }

  async cancelBrowserSessionInternal(sessionId: string) {
    const { session } = await requireBrowserSession(sessionId);
    if (
      !isOwnedByCurrentInstance(session) &&
      !this.browserSessionManager.hasLiveSession(session.id)
    ) {
      throw new AppError(
        409,
        'Browser session is not live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    if (this.browserSessionManager.hasLiveSession(session.id)) {
      await this.browserSessionManager.cancelSession(session.id);
    } else {
      const updatedSession = await mcpBrowserSessionRepository.update(session.id, {
        status: 'cancelled',
        endedAt: new Date(),
      });
      if (updatedSession) {
        await this.updateBrowserSessionMessage(updatedSession);
      }
    }

    const updated = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
    await this.updateBrowserSessionMessage(updated);
    return {
      ok: true as const,
      session: toBrowserSessionDto(updated),
    };
  }

  async executePlaywrightTool(
    userId: string,
    connectionId: string,
    input: {
      toolName: string;
      arguments: Record<string, unknown>;
    },
  ) {
    const connection = await requireOwnedConnection(userId, connectionId);
    const activeSession = await mcpBrowserSessionRepository.findActiveByConnection(connection.id);
    if (activeSession && activeSession.status !== 'completed') {
      return {
        success: false,
        result: null,
        error: 'BROWSER_SESSION_BUSY',
      };
    }

    const runtimeConnection = toRuntimeConnection(connection);
    const result = await this.runtime.executeTool({
      toolName: input.toolName,
      arguments: input.arguments,
      connection: runtimeConnection,
    });

    if (result.success && result.connectionUpdate) {
      const nextCredentials = result.connectionUpdate.credentials
        ? encryptCredentials({
            ...runtimeConnection.credentials,
            ...result.connectionUpdate.credentials,
          })
        : undefined;
      const nextSettings = result.connectionUpdate.settings
        ? {
            ...connection.settings,
            ...result.connectionUpdate.settings,
          }
        : undefined;

      await mcpConnectionRepository.update(connection.id, {
        encryptedCredentials: nextCredentials,
        settings: nextSettings,
      });
    }

    return result;
  }
}
