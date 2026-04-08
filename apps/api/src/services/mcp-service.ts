import {
  mcpBrowserSessionRepository,
  mcpProfileRepository,
  messageRepository,
  type McpBrowserSession,
  type McpProfile,
} from '@aaa/db';
import { decryptCredentials, encryptCredentials } from '@aaa/knowledge-sources';
import { getMcpRuntime, type RuntimeMcpProfile } from '@aaa/mcp';
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
const OWNER_UNREACHABLE_CODES = new Set([
  'MCP_BROWSER_SESSION_NOT_LIVE',
  'BROWSER_SESSION_NOT_LIVE',
  'MCP_BROWSER_SESSION_OWNER_UNREACHABLE',
]);

function hasCredentialMaterial(credentials: Record<string, unknown>): boolean {
  return Object.keys(credentials).length > 0;
}

function toRuntimeProfile(
  profile: McpProfile,
  credentials = decryptCredentials(profile.encryptedCredentials),
): RuntimeMcpProfile {
  return {
    id: profile.id,
    userId: profile.userId,
    integrationKind: profile.integrationKind as RuntimeMcpProfile['integrationKind'],
    profileLabel: profile.profileLabel,
    status: profile.status,
    settings: profile.settings,
    credentials,
  };
}

function toProfileSummary(profile: McpProfile) {
  const credentials = decryptCredentials(profile.encryptedCredentials);
  return {
    id: profile.id,
    integrationKind: profile.integrationKind as 'playwright',
    profileLabel: profile.profileLabel,
    status: profile.status,
    hasCredentials: hasCredentialMaterial(credentials),
    lastError: profile.lastError,
    isDefault: profile.isDefault,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function toBrowserSessionDto(session: McpBrowserSession) {
  return {
    id: session.id,
    userId: session.userId,
    mcpProfileId: session.mcpProfileId,
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

async function requireOwnedProfile(userId: string, profileId: string): Promise<McpProfile> {
  const profile = await mcpProfileRepository.findByIdForUser(profileId, userId);
  if (!profile) {
    throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
  }
  return profile;
}

async function requireOwnedBrowserSession(
  userId: string,
  sessionId: string,
): Promise<{ session: McpBrowserSession; profile: McpProfile }> {
  const session = await mcpBrowserSessionRepository.findById(sessionId);
  if (!session || session.userId !== userId) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  const profile = await mcpProfileRepository.findById(session.mcpProfileId);
  if (!profile || profile.userId !== userId) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  return { session, profile };
}

async function requireBrowserSession(
  sessionId: string,
): Promise<{ session: McpBrowserSession; profile: McpProfile }> {
  const session = await mcpBrowserSessionRepository.findById(sessionId);
  if (!session) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  const profile = await mcpProfileRepository.findById(session.mcpProfileId);
  if (!profile) {
    throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
  }

  return { session, profile };
}

function isOwnedByCurrentInstance(
  session: Pick<McpBrowserSession, 'ownerApiInstanceId'>,
): boolean {
  return !session.ownerApiInstanceId || session.ownerApiInstanceId === getApiInstanceId();
}

function hasRemoteOwner(
  session: Pick<McpBrowserSession, 'ownerApiInstanceId' | 'ownerApiInstanceUrl'>,
): boolean {
  return !isOwnedByCurrentInstance(session) && Boolean(session.ownerApiInstanceUrl);
}

function buildInternalBrowserSessionUrl(
  ownerApiInstanceUrl: string,
  sessionId: string,
  suffix = '',
): string {
  const base = new URL(ownerApiInstanceUrl);
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

function hasConversationContext(input: {
  conversationId?: string;
  toolExecutionId?: string;
}): input is { conversationId: string; toolExecutionId?: string } {
  return typeof input.conversationId === 'string' && input.conversationId.trim().length > 0;
}

export class McpService {
  private readonly runtime = getMcpRuntime();
  private readonly browserSessionManager = getBrowserSessionManager();

  listCatalog() {
    return this.runtime.listCatalog();
  }

  async listProfiles(userId: string) {
    const profiles = await mcpProfileRepository.listByUser(userId);
    return profiles.map(toProfileSummary);
  }

  async createProfile(
    userId: string,
    input: {
      integrationKind: 'playwright';
      profileLabel: string;
      authMode?: 'embedded_browser' | 'stored_secret';
      secretProfile?: Record<string, unknown>;
    },
  ) {
    const existing = await mcpProfileRepository.listByUser(userId);
    const hasDefaultForKind = existing.some(
      (profile) => profile.integrationKind === input.integrationKind && profile.isDefault,
    );

    const credentials: Record<string, unknown> = {};
    if (input.secretProfile) {
      credentials['secretProfiles'] = { default: input.secretProfile };
    }

    const profile = await mcpProfileRepository.create({
      userId,
      integrationKind: input.integrationKind,
      profileLabel: input.profileLabel,
      status: input.authMode === 'stored_secret' && input.secretProfile ? 'connected' : 'pending',
      encryptedCredentials: encryptCredentials(credentials),
      settings: {},
      isDefault: !hasDefaultForKind,
    });

    return toProfileSummary(profile);
  }

  async setDefaultProfile(userId: string, profileId: string) {
    const profile = await mcpProfileRepository.setDefault(profileId, userId);
    if (!profile) {
      throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
    }

    return toProfileSummary(profile);
  }

  async deleteProfile(userId: string, profileId: string) {
    const profile = await requireOwnedProfile(userId, profileId);
    const activeSession = await mcpBrowserSessionRepository.findActiveByProfile(profile.id);
    if (activeSession) {
      if (hasRemoteOwner(activeSession)) {
        try {
          await this.proxyBrowserSessionRequest(activeSession, {
            suffix: 'cancel',
            method: 'POST',
          });
        } catch {
          await this.markBrowserSessionAsCrashed(activeSession, 'owner_api_instance_unreachable');
        }
      } else if (this.browserSessionManager.hasLiveSession(activeSession.id)) {
        await this.browserSessionManager.cancelSession(activeSession.id, 'profile_deleted');
      }
    }

    const deleted = await mcpProfileRepository.delete(profileId, userId);
    if (!deleted) {
      throw new AppError(404, 'MCP profile not found', 'MCP_PROFILE_NOT_FOUND');
    }

    if (profile.isDefault) {
      const remaining = await mcpProfileRepository.listByUser(userId);
      const replacement = remaining.find(
        (candidate) => candidate.integrationKind === profile.integrationKind,
      );
      if (replacement) {
        await mcpProfileRepository.setDefault(replacement.id, userId);
      }
    }

    await this.runtime.invalidateProfile(profileId);
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
      'id' | 'messageId' | 'status' | 'expiresAt' | 'endedAt' | 'metadata'
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
          terminalReason: reason,
        },
      })) ?? session;
    await this.updateBrowserSessionMessage(updated);
    return updated;
  }

  private async createBrowserSessionMessage(
    session: McpBrowserSession,
    profile: McpProfile,
  ): Promise<McpBrowserSession> {
    if (!session.conversationId) {
      return session;
    }

    const message = await messageRepository.create(session.conversationId, 'assistant', [
      buildBrowserSessionContentBlock(session, {
        profileLabel: profile.profileLabel,
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
    session: Pick<McpBrowserSession, 'id' | 'ownerApiInstanceUrl'>,
    input?: {
      suffix?: string;
      method?: 'GET' | 'POST';
      body?: Record<string, unknown>;
    },
  ): Promise<T> {
    if (!session.ownerApiInstanceUrl) {
      throw new AppError(
        409,
        'Browser session owner is unavailable',
        'MCP_BROWSER_SESSION_OWNER_UNAVAILABLE',
      );
    }

    const response = await fetch(
      buildInternalBrowserSessionUrl(session.ownerApiInstanceUrl, session.id, input?.suffix),
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

  private normalizeSnapshotResponse(
    session: McpBrowserSession,
    snapshot: {
      pages: Array<{ pageId: string; url: string; title: string; isSelected: boolean }>;
    },
  ) {
    return {
      session: toBrowserSessionDto(session),
      pages: snapshot.pages.map((page) => ({
        id: page.pageId,
        url: page.url,
        title: page.title,
        isSelected: page.isSelected,
      })),
    };
  }

  private async getExistingActiveSessionResult(
    existing: McpBrowserSession,
  ): Promise<{
    session: ReturnType<typeof toBrowserSessionDto>;
    pages: Array<{ id: string; url: string; title: string; isSelected: boolean }>;
  }> {
    if (hasRemoteOwner(existing)) {
      return this.proxyBrowserSessionRequest(existing);
    }

    if (this.browserSessionManager.hasLiveSession(existing.id)) {
      const snapshot = await this.browserSessionManager.getSnapshot(existing.id);
      return this.normalizeSnapshotResponse(existing, snapshot);
    }

    const crashed = await this.markBrowserSessionAsCrashed(existing, 'live_session_not_present_on_api');
    return {
      session: toBrowserSessionDto(crashed),
      pages: [],
    };
  }

  private async ensureConversationBrowserSession(
    userId: string,
    profile: McpProfile,
    input: {
      conversationId: string;
      toolExecutionId?: string;
      startUrl?: string;
    },
  ): Promise<{
    session: McpBrowserSession;
    pages: Array<{ id: string; url: string; title: string; isSelected: boolean }>;
  }> {
    const existing = await mcpBrowserSessionRepository.findActiveByProfile(profile.id);
    if (existing) {
      if (existing.conversationId && existing.conversationId !== input.conversationId) {
        throw new AppError(
          409,
          'Browser profile already has an active live session in another conversation',
          'BROWSER_PROFILE_BUSY',
        );
      }

      const existingResult = await this.getExistingActiveSessionResult(existing);
      const refreshedSession = (await mcpBrowserSessionRepository.findById(existing.id)) ?? existing;
      if (refreshedSession.status !== 'pending' && refreshedSession.status !== 'active') {
        const created = await this.createBrowserSession(userId, profile.id, {
          purpose: 'manual',
          conversationId: input.conversationId,
          toolExecutionId: input.toolExecutionId,
          startUrl: input.startUrl,
        });
        const session = await mcpBrowserSessionRepository.findById(created.session.id);
        if (!session) {
          throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
        }

        return {
          session,
          pages: created.pages,
        };
      }

      if (!refreshedSession.conversationId) {
        throw new AppError(
          409,
          'Browser profile already has an active standalone live session',
          'BROWSER_PROFILE_BUSY',
        );
      }

      return {
        session: refreshedSession,
        pages: existingResult.pages,
      };
    }

    const created = await this.createBrowserSession(userId, profile.id, {
      purpose: 'manual',
      conversationId: input.conversationId,
      toolExecutionId: input.toolExecutionId,
      startUrl: input.startUrl,
    });
    const session = await mcpBrowserSessionRepository.findById(created.session.id);
    if (!session) {
      throw new AppError(404, 'Browser session not found', 'MCP_BROWSER_SESSION_NOT_FOUND');
    }

    return {
      session,
      pages: created.pages,
    };
  }

  private async executePlaywrightToolInBrowserSession(
    session: McpBrowserSession,
    profile: McpProfile,
    input: {
      toolName: string;
      arguments: Record<string, unknown>;
    },
  ) {
    const credentials = decryptCredentials(profile.encryptedCredentials);

    if (hasRemoteOwner(session)) {
      return this.proxyBrowserSessionRequest<{
        success: boolean;
        result: unknown;
        error?: string;
      }>(session, {
        suffix: 'execute-tool',
        method: 'POST',
        body: {
          toolName: input.toolName,
          input: input.arguments,
        },
      });
    }

    if (!this.browserSessionManager.hasLiveSession(session.id)) {
      throw new AppError(
        409,
        'Browser session is no longer live on this API instance',
        'MCP_BROWSER_SESSION_NOT_LIVE',
      );
    }

    const result = await this.browserSessionManager.executePlaywrightTool(
      session.id,
      input.toolName,
      input.arguments,
      credentials,
    );

    if (result.success) {
      const storageState = await this.browserSessionManager.getStorageState(session.id);
      await mcpProfileRepository.update(profile.id, {
        encryptedCredentials: encryptCredentials({
          ...credentials,
          storageState,
        }),
        lastError: null,
      });
    }

    return result;
  }

  async createBrowserSession(
    userId: string,
    profileId: string,
    input: {
      purpose: 'sign_in' | 'manual' | 'handoff';
      conversationId?: string;
      toolExecutionId?: string;
      startUrl?: string;
      handoffReason?: string;
    },
  ) {
    const profile = await requireOwnedProfile(userId, profileId);
    const existing = await mcpBrowserSessionRepository.findActiveByProfile(profile.id);
    if (existing) {
      if (input.purpose === 'handoff') {
        if (input.conversationId && existing.conversationId === input.conversationId) {
          return this.getExistingActiveSessionResult(existing);
        }

        throw new AppError(
          409,
          'Browser profile already has an active live session',
          'BROWSER_PROFILE_BUSY',
        );
      }

      return this.getExistingActiveSessionResult(existing);
    }

    const metadata: Record<string, unknown> = {};
    if (input.handoffReason) {
      metadata['handoffReason'] = input.handoffReason;
    }

    let session = await mcpBrowserSessionRepository.create({
      userId,
      mcpProfileId: profile.id,
      purpose: input.purpose,
      conversationId: input.conversationId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
      metadata,
      ownerApiInstanceId: getApiInstanceId(),
      ownerApiInstanceUrl: getApiInternalBaseUrl(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    session = await this.createBrowserSessionMessage(session, profile);

    try {
      const snapshot = await this.browserSessionManager.createSession(session, profile, {
        startUrl:
          input.startUrl ??
          (input.purpose === 'sign_in' &&
          typeof profile.settings['signInStartUrl'] === 'string'
            ? profile.settings['signInStartUrl']
            : undefined),
      });

      const updatedSession = (await mcpBrowserSessionRepository.findById(session.id)) ?? session;
      await this.updateBrowserSessionMessage(updatedSession);
      return this.normalizeSnapshotResponse(updatedSession, snapshot);
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
        if (!code || !OWNER_UNREACHABLE_CODES.has(code)) {
          throw error;
        }
        const crashedSession = await this.markBrowserSessionAsCrashed(
          session,
          'owner_api_instance_unreachable',
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
            metadata: {
              ...session.metadata,
              terminalReason: 'session_expired',
            },
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
    const { session, profile } = await requireOwnedBrowserSession(userId, sessionId);
    if (hasRemoteOwner(session)) {
      return this.proxyBrowserSessionRequest<{
        session: ReturnType<typeof toBrowserSessionDto>;
        profile: ReturnType<typeof toProfileSummary>;
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
    const currentCredentials = decryptCredentials(profile.encryptedCredentials);
    const updatedProfile = await mcpProfileRepository.update(profile.id, {
      status: 'connected',
      encryptedCredentials: encryptCredentials({
        ...currentCredentials,
        storageState,
      }),
      lastError: null,
      isDefault: input.persistAsDefault ? true : profile.isDefault,
    });

    if (input.persistAsDefault) {
      await mcpProfileRepository.setDefault(profile.id, userId);
    }

    const updatedSession = await mcpBrowserSessionRepository.findById(session.id);
    if (updatedSession) {
      await this.updateBrowserSessionMessage(updatedSession);
    }
    return {
      session: toBrowserSessionDto(updatedSession ?? session),
      profile: toProfileSummary(updatedProfile ?? profile),
      pages: [],
    };
  }

  async persistBrowserSessionInternal(
    sessionId: string,
    input: { persistAsDefault?: boolean },
  ) {
    const { session, profile } = await requireBrowserSession(sessionId);
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
    const currentCredentials = decryptCredentials(profile.encryptedCredentials);
    const updatedProfile = await mcpProfileRepository.update(profile.id, {
      status: 'connected',
      encryptedCredentials: encryptCredentials({
        ...currentCredentials,
        storageState,
      }),
      lastError: null,
      isDefault: input.persistAsDefault ? true : profile.isDefault,
    });

    if (input.persistAsDefault) {
      await mcpProfileRepository.setDefault(profile.id, session.userId);
    }

    const updatedSession = await mcpBrowserSessionRepository.findById(session.id);
    if (updatedSession) {
      await this.updateBrowserSessionMessage(updatedSession);
    }

    return {
      session: toBrowserSessionDto(updatedSession ?? session),
      profile: toProfileSummary(updatedProfile ?? profile),
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
        metadata: {
          ...session.metadata,
          terminalReason: 'cancelled_by_user',
        },
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
        metadata: {
          ...session.metadata,
          terminalReason: 'cancelled_by_user',
        },
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

  async executePlaywrightToolInBrowserSessionInternal(
    sessionId: string,
    input: {
      toolName: string;
      arguments: Record<string, unknown>;
    },
  ) {
    const { session, profile } = await requireBrowserSession(sessionId);
    return this.executePlaywrightToolInBrowserSession(session, profile, input);
  }

  private async startHandoffTool(
    userId: string,
    profileId: string,
    input: {
      arguments: Record<string, unknown>;
      conversationId?: string;
      toolExecutionId?: string;
    },
  ) {
    if (!input.conversationId) {
      return {
        success: false,
        result: null,
        error: 'playwright.start_handoff requires a conversation context',
      };
    }

    const reason = typeof input.arguments['reason'] === 'string' ? input.arguments['reason'].trim() : '';
    if (!reason) {
      return {
        success: false,
        result: null,
        error: 'playwright.start_handoff requires a reason',
      };
    }

    try {
      const result = await this.createBrowserSession(userId, profileId, {
        purpose: 'handoff',
        conversationId: input.conversationId,
        toolExecutionId: input.toolExecutionId,
        startUrl:
          typeof input.arguments['url'] === 'string' && input.arguments['url'].trim().length > 0
            ? input.arguments['url'].trim()
            : undefined,
        handoffReason: reason,
      });

      return {
        success: true,
        result: {
          session: result.session,
          pages: result.pages,
          started: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : 'Failed to start browser handoff',
      };
    }
  }

  async executePlaywrightTool(
    userId: string,
    profileId: string,
    input: {
      toolName: string;
      arguments: Record<string, unknown>;
      conversationId?: string;
      toolExecutionId?: string;
    },
  ) {
    const profile = await requireOwnedProfile(userId, profileId);

    if (input.toolName === 'playwright.start_handoff') {
      return this.startHandoffTool(userId, profile.id, input);
    }

    if (hasConversationContext(input)) {
      try {
        const { session } = await this.ensureConversationBrowserSession(userId, profile, {
          conversationId: input.conversationId,
          toolExecutionId: input.toolExecutionId,
          startUrl:
            typeof input.arguments['url'] === 'string' && input.arguments['url'].trim().length > 0
              ? input.arguments['url'].trim()
              : undefined,
        });

        const result = await this.executePlaywrightToolInBrowserSession(session, profile, {
          toolName: input.toolName,
          arguments: input.arguments,
        });

        return {
          success: result.success,
          result: result.result,
          error: result.error,
        };
      } catch (error) {
        return {
          success: false,
          result: null,
          error: error instanceof Error ? error.message : 'Failed to execute Playwright tool',
        };
      }
    }

    const activeSession = await mcpBrowserSessionRepository.findActiveByProfile(profile.id);
    if (activeSession && activeSession.status !== 'completed') {
      return {
        success: false,
        result: null,
        error: 'BROWSER_PROFILE_BUSY',
      };
    }

    const runtimeProfile = toRuntimeProfile(profile);
    const result = await this.runtime.executeTool({
      toolName: input.toolName,
      arguments: input.arguments,
      profile: runtimeProfile,
    });

    if (result.success && result.profileUpdate) {
      const nextCredentials = result.profileUpdate.credentials
        ? encryptCredentials({
            ...runtimeProfile.credentials,
            ...result.profileUpdate.credentials,
          })
        : undefined;
      const nextSettings = result.profileUpdate.settings
        ? {
            ...profile.settings,
            ...result.profileUpdate.settings,
          }
        : undefined;

      await mcpProfileRepository.update(profile.id, {
        encryptedCredentials: nextCredentials,
        settings: nextSettings,
      });
    }

    return {
      success: result.success,
      result: result.result,
      error: result.error,
    };
  }
}
