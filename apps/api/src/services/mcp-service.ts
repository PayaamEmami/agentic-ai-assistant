import {
  mcpBrowserSessionRepository,
  mcpConnectionRepository,
  type McpBrowserSession,
  type McpConnection,
} from '@aaa/db';
import { decryptConnectorCredentials, encryptConnectorCredentials } from '@aaa/connectors';
import { getMcpRuntime, type RuntimeMcpConnection } from '@aaa/mcp';
import { AppError } from '../lib/errors.js';
import { getBrowserSessionManager } from './browser-session-manager.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

function hasCredentialMaterial(credentials: Record<string, unknown>): boolean {
  return Object.keys(credentials).length > 0;
}

function toRuntimeConnection(
  connection: McpConnection,
  credentials = decryptConnectorCredentials(connection.encryptedCredentials),
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
  const credentials = decryptConnectorCredentials(connection.encryptedCredentials);
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
      encryptedCredentials: encryptConnectorCredentials(credentials),
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
    if (activeSession && this.browserSessionManager.hasLiveSession(activeSession.id)) {
      await this.browserSessionManager.cancelSession(activeSession.id, 'connection_deleted');
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
      if (this.browserSessionManager.hasLiveSession(existing.id)) {
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
      }

      await mcpBrowserSessionRepository.update(existing.id, {
        status: 'crashed',
        endedAt: new Date(),
        metadata: {
          ...existing.metadata,
          reason: 'live_session_not_present_on_api',
        },
      });
    }

    const session = await mcpBrowserSessionRepository.create({
      userId,
      mcpConnectionId: connection.id,
      purpose: input.purpose,
      conversationId: input.conversationId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
      metadata: {},
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    const snapshot = await this.browserSessionManager.createSession(session, connection, {
      startUrl:
        input.purpose === 'auth'
          ? (typeof connection.settings['manualAuthStartUrl'] === 'string'
              ? connection.settings['manualAuthStartUrl']
              : undefined)
          : undefined,
    });

    const updatedSession = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
    return {
      session: toBrowserSessionDto(updatedSession),
      pages: snapshot.pages.map((page) => ({
        id: page.pageId,
        url: page.url,
        title: page.title,
        isSelected: page.isSelected,
      })),
    };
  }

  async getBrowserSession(userId: string, sessionId: string) {
    const { session } = await requireOwnedBrowserSession(userId, sessionId);

    if (session.status === 'pending' || session.status === 'active') {
      if (session.expiresAt.getTime() < Date.now()) {
        if (this.browserSessionManager.hasLiveSession(session.id)) {
          await this.browserSessionManager.expireSession(session.id, 'session_expired');
        } else {
          await mcpBrowserSessionRepository.update(session.id, {
            status: 'expired',
            endedAt: new Date(),
          });
        }
      } else if (!this.browserSessionManager.hasLiveSession(session.id)) {
        await mcpBrowserSessionRepository.update(session.id, {
          status: 'crashed',
          endedAt: new Date(),
          metadata: {
            ...session.metadata,
            reason: 'session_not_live_on_api',
          },
        });
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
    const currentCredentials = decryptConnectorCredentials(connection.encryptedCredentials);
    const updatedConnection = await mcpConnectionRepository.update(connection.id, {
      status: 'connected',
      encryptedCredentials: encryptConnectorCredentials({
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
    return {
      session: toBrowserSessionDto(updatedSession ?? session),
      connection: toConnectionSummary(updatedConnection ?? connection),
      pages: [],
    };
  }

  async cancelBrowserSession(userId: string, sessionId: string) {
    const { session } = await requireOwnedBrowserSession(userId, sessionId);
    if (this.browserSessionManager.hasLiveSession(session.id)) {
      await this.browserSessionManager.cancelSession(session.id);
    } else {
      await mcpBrowserSessionRepository.update(session.id, {
        status: 'cancelled',
        endedAt: new Date(),
      });
    }

    const updated = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
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
        ? encryptConnectorCredentials({
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
