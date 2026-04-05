import {
  mcpAuthSessionRepository,
  mcpConnectionRepository,
  type McpAuthSession,
  type McpConnection,
} from '@aaa/db';
import { decryptConnectorCredentials, encryptConnectorCredentials } from '@aaa/connectors';
import { getMcpRuntime, type RuntimeMcpConnection } from '@aaa/mcp';
import { AppError } from '../lib/errors.js';

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

function toAuthSessionDto(session: McpAuthSession) {
  return {
    id: session.id,
    mcpConnectionId: session.mcpConnectionId,
    status: session.status,
    metadata: session.metadata,
    expiresAt: session.expiresAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export class McpService {
  private readonly runtime = getMcpRuntime();

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
    const connection = await mcpConnectionRepository.findByIdForUser(connectionId, userId);
    if (!connection) {
      throw new AppError(404, 'MCP connection not found', 'MCP_CONNECTION_NOT_FOUND');
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

  async startAuthSession(userId: string, connectionId: string) {
    const connection = await mcpConnectionRepository.findByIdForUser(connectionId, userId);
    if (!connection) {
      throw new AppError(404, 'MCP connection not found', 'MCP_CONNECTION_NOT_FOUND');
    }

    const authSession = await mcpAuthSessionRepository.create({
      mcpConnectionId: connection.id,
      status: 'active',
      metadata: {},
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    try {
      const startResult = await this.runtime.startManualAuthSession(
        toRuntimeConnection(connection),
        authSession.id,
      );

      const updated = await mcpAuthSessionRepository.update(authSession.id, {
        status: 'active',
        metadata: startResult.metadata,
      });

      return toAuthSessionDto(updated ?? authSession);
    } catch (error) {
      await mcpConnectionRepository.update(connection.id, {
        status: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });
      await mcpAuthSessionRepository.update(authSession.id, {
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async getAuthSession(userId: string, authSessionId: string) {
    const authSession = await mcpAuthSessionRepository.findById(authSessionId);
    if (!authSession) {
      throw new AppError(404, 'MCP auth session not found', 'MCP_AUTH_SESSION_NOT_FOUND');
    }

    const connection = await mcpConnectionRepository.findById(authSession.mcpConnectionId);
    if (!connection || connection.userId !== userId) {
      throw new AppError(404, 'MCP auth session not found', 'MCP_AUTH_SESSION_NOT_FOUND');
    }

    if (authSession.status === 'active' && authSession.expiresAt.getTime() < Date.now()) {
      const expired = await mcpAuthSessionRepository.update(authSession.id, {
        status: 'expired',
      });
      return toAuthSessionDto(expired ?? authSession);
    }

    return toAuthSessionDto(authSession);
  }

  async completeAuthSession(
    userId: string,
    authSessionId: string,
    input: { persistAsDefault?: boolean },
  ) {
    const authSession = await mcpAuthSessionRepository.findById(authSessionId);
    if (!authSession) {
      throw new AppError(404, 'MCP auth session not found', 'MCP_AUTH_SESSION_NOT_FOUND');
    }

    const connection = await mcpConnectionRepository.findById(authSession.mcpConnectionId);
    if (!connection || connection.userId !== userId) {
      throw new AppError(404, 'MCP auth session not found', 'MCP_AUTH_SESSION_NOT_FOUND');
    }

    if (authSession.expiresAt.getTime() < Date.now()) {
      await mcpAuthSessionRepository.update(authSession.id, { status: 'expired' });
      throw new AppError(409, 'MCP auth session has expired', 'MCP_AUTH_SESSION_EXPIRED');
    }

    const completion = await this.runtime.completeManualAuthSession(
      toRuntimeConnection(connection),
      authSession.id,
    );

    const currentCredentials = decryptConnectorCredentials(connection.encryptedCredentials);
    const nextCredentials = completion.connectionUpdate?.credentials
      ? {
          ...currentCredentials,
          ...completion.connectionUpdate.credentials,
        }
      : currentCredentials;
    const nextSettings = completion.connectionUpdate?.settings
      ? {
          ...connection.settings,
          ...completion.connectionUpdate.settings,
        }
      : connection.settings;

    const updatedConnection = await mcpConnectionRepository.update(connection.id, {
      status: 'connected',
      encryptedCredentials: encryptConnectorCredentials(nextCredentials),
      settings: nextSettings,
      lastError: null,
      isDefaultActive: input.persistAsDefault ? true : connection.isDefaultActive,
    });

    if (input.persistAsDefault) {
      await mcpConnectionRepository.setDefaultActive(connection.id, userId);
    }

    const updatedSession = await mcpAuthSessionRepository.update(authSession.id, {
      status: 'completed',
      metadata: {
        ...authSession.metadata,
        ...completion.metadata,
      },
      completedAt: new Date(),
    });

    return {
      authSession: toAuthSessionDto(updatedSession ?? authSession),
      connection: toConnectionSummary(updatedConnection ?? connection),
    };
  }
}
