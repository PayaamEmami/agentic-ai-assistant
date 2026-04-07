import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { mcpBrowserSessionRepository, type McpBrowserSession } from '@aaa/db';
import type {
  BrowserAttachRequestEvent,
  BrowserClientEvent,
  BrowserControlStateEvent,
  BrowserErrorEvent,
  BrowserSessionAttachedEvent,
  BrowserServerEvent,
} from '@aaa/shared';
import WebSocket, { type RawData } from 'ws';
import { logger } from '../lib/logger.js';
import {
  assertInternalServiceSecret,
  getApiInstanceId,
  getInternalServiceSecret,
} from '../lib/internal-service.js';
import { authenticateToken, extractBearerToken, type AuthUser } from '../middleware/auth.js';
import { getBrowserSessionManager } from '../services/browser-session-manager.js';

function getQueryParams(rawUrl: string | undefined): URLSearchParams | null {
  if (!rawUrl) {
    return null;
  }

  const url = new URL(rawUrl, 'http://localhost');
  return url.searchParams;
}

function getQueryToken(rawUrl: string | undefined): string | null {
  const params = getQueryParams(rawUrl);
  const token = params?.get('token');
  return token && token.trim().length > 0 ? token.trim() : null;
}

function getInternalSecret(rawUrl: string | undefined): string | null {
  const params = getQueryParams(rawUrl);
  const token = params?.get('internalServiceSecret');
  return token && token.trim().length > 0 ? token.trim() : null;
}

function sendJson(socket: WebSocket, payload: BrowserServerEvent | BrowserErrorEvent): void {
  socket.send(JSON.stringify(payload));
}

function sendError(socket: WebSocket, code: string, message: string, sessionId?: string): void {
  const payload: BrowserErrorEvent = {
    type: 'browser.error',
    sessionId,
    code,
    message,
  };
  sendJson(socket, payload);
}

function isAttachEvent(value: BrowserClientEvent): value is BrowserAttachRequestEvent {
  return value.type === 'browser.attach' && typeof value.sessionId === 'string';
}

function isOwnedByCurrentInstance(
  session: Pick<McpBrowserSession, 'ownerApiInstanceId'>,
): boolean {
  return !session.ownerApiInstanceId || session.ownerApiInstanceId === getApiInstanceId();
}

function toSocketPayload(data: RawData): string | Buffer {
  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  const view = data as ArrayBufferView;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function buildInternalBrowserProxyUrl(ownerApiInstanceUrl: string, correlationId: string): string {
  const base = new URL(ownerApiInstanceUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/ws/browser/internal';
  base.searchParams.set('internalServiceSecret', getInternalServiceSecret());
  base.searchParams.set('correlationId', correlationId);
  return base.toString();
}

async function authenticateSocket(token: string | null): Promise<AuthUser> {
  if (!token) {
    throw new Error('Authentication required');
  }
  return authenticateToken(token);
}

async function attachLocalSession(
  socket: WebSocket,
  input: {
    sessionId: string;
    viewerId: string;
    manager: ReturnType<typeof getBrowserSessionManager>;
    setDetach: (detach: (() => void) | null) => void;
  },
): Promise<void> {
  const { manager, sessionId, viewerId, setDetach } = input;
  const session = await mcpBrowserSessionRepository.findById(sessionId);
  if (!session) {
    sendError(socket, 'BROWSER_SESSION_NOT_FOUND', 'Browser session not found');
    return;
  }

  if (!isOwnedByCurrentInstance(session)) {
    sendError(
      socket,
      'BROWSER_SESSION_NOT_OWNER',
      'Browser session is owned by a different API instance',
      sessionId,
    );
    return;
  }

  const detach = manager.subscribe(session.id, viewerId, {
    onServerEvent: (event) => {
      sendJson(socket, event);
    },
    onFrame: ({ meta, buffer }) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      sendJson(socket, meta);
      socket.send(buffer);
    },
    onControlChanged: (controlViewerId) => {
      const payload: BrowserControlStateEvent = {
        type: 'browser.control.state',
        sessionId: session.id,
        controlGranted: controlViewerId === viewerId,
      };
      sendJson(socket, payload);
    },
  });
  setDetach(detach);
  await manager.heartbeat(session.id);
  const snapshot = await manager.getSnapshot(session.id);
  const attachedPayload: BrowserSessionAttachedEvent = {
    type: 'browser.session.attached',
    sessionId: snapshot.sessionId,
    mcpProfileId: snapshot.mcpProfileId,
    status: snapshot.status,
    purpose: snapshot.purpose,
    selectedPageId: snapshot.selectedPageId,
    controlGranted: manager.hasControl(session.id, viewerId),
    pages: snapshot.pages,
    viewport: snapshot.viewport,
  };
  sendJson(socket, attachedPayload);
}

export async function browserWsHandler(app: FastifyInstance) {
  app.get(
    '/browser',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const viewerId = crypto.randomUUID();
      const token =
        getQueryToken(request.raw.url) ?? extractBearerToken(request.headers.authorization);
      const correlationId =
        getQueryParams(request.raw.url)?.get('correlationId')?.trim() ?? viewerId;

      let user: AuthUser;
      try {
        user = await authenticateSocket(token);
      } catch {
        socket.close(1008, 'Authentication failed');
        return;
      }

      const manager = getBrowserSessionManager();
      let detach: (() => void) | null = null;
      let attachedSessionId: string | null = null;
      let proxySocket: WebSocket | null = null;
      let proxyReady = false;
      let proxyQueue: Array<string | Buffer> = [];

      socket.binaryType = 'arraybuffer';

      const clearLocalDetach = () => {
        detach?.();
        detach = null;
      };

      const clearProxySocket = () => {
        if (!proxySocket) {
          return;
        }

        proxySocket.removeAllListeners();
        if (
          proxySocket.readyState === WebSocket.OPEN ||
          proxySocket.readyState === WebSocket.CONNECTING
        ) {
          proxySocket.close();
        }
        proxySocket = null;
        proxyReady = false;
        proxyQueue = [];
      };

      const attachRemoteOwner = (session: McpBrowserSession) => {
        clearLocalDetach();
        clearProxySocket();
        attachedSessionId = session.id;

        if (!session.ownerApiInstanceUrl) {
          sendError(
            socket,
            'BROWSER_SESSION_OWNER_UNAVAILABLE',
            'Browser session owner is unavailable',
            session.id,
          );
          return;
        }

        const remote = new WebSocket(
          buildInternalBrowserProxyUrl(session.ownerApiInstanceUrl, correlationId),
        );
        remote.binaryType = 'arraybuffer';
        proxySocket = remote;
        proxyReady = false;
        proxyQueue = [JSON.stringify({ type: 'browser.attach', sessionId: session.id })];

        remote.on('open', () => {
          proxyReady = true;
          for (const payload of proxyQueue) {
            remote.send(payload);
          }
          proxyQueue = [];
        });

        remote.on('message', (data, isBinary) => {
          if (socket.readyState !== WebSocket.OPEN) {
            return;
          }

          const payload = toSocketPayload(data);
          socket.send(payload, { binary: isBinary });
        });

        remote.on('close', () => {
          if (proxySocket === remote) {
            proxySocket = null;
            proxyReady = false;
            proxyQueue = [];
          }
          if (socket.readyState === WebSocket.OPEN) {
            sendError(
              socket,
              'BROWSER_SESSION_PROXY_CLOSED',
              'Remote browser session owner disconnected',
              session.id,
            );
          }
        });

        remote.on('error', (error) => {
          logger.warn(
            {
              event: 'browser.ws.proxy_failed',
              outcome: 'failure',
              error,
              sessionId: session.id,
              ownerApiInstanceUrl: session.ownerApiInstanceUrl,
              viewerId,
              userId: user.id,
            },
            'Failed to proxy remote browser websocket session',
          );
          if (socket.readyState === WebSocket.OPEN) {
            sendError(
              socket,
              'BROWSER_SESSION_OWNER_UNREACHABLE',
              'Browser session owner is unavailable',
              session.id,
            );
          }
        });
      };

      socket.on('message', (raw) => {
        if (!(typeof raw === 'string' || raw instanceof Buffer)) {
          return;
        }

        const text = raw.toString();
        let parsed: BrowserClientEvent;
        try {
          parsed = JSON.parse(text) as BrowserClientEvent;
        } catch {
          sendError(socket, 'BROWSER_INVALID_MESSAGE', 'Invalid browser websocket message');
          return;
        }

        if (isAttachEvent(parsed)) {
          void (async () => {
            const session = await mcpBrowserSessionRepository.findById(parsed.sessionId);
            if (!session || session.userId !== user.id) {
              sendError(socket, 'BROWSER_SESSION_NOT_FOUND', 'Browser session not found');
              return;
            }

            if (!isOwnedByCurrentInstance(session)) {
              attachRemoteOwner(session);
              return;
            }

            clearProxySocket();
            clearLocalDetach();
            attachedSessionId = session.id;
            await attachLocalSession(socket, {
              manager,
              sessionId: session.id,
              viewerId,
              setDetach: (nextDetach) => {
                detach = nextDetach;
              },
            });
          })().catch((error) => {
            logger.warn(
              {
                event: 'browser.ws.attach_failed',
                outcome: 'failure',
                error,
                viewerId,
                userId: user.id,
              },
              'Failed to attach browser websocket viewer',
            );
            sendError(socket, 'BROWSER_ATTACH_FAILED', 'Failed to attach browser session');
          });
          return;
        }

        if (proxySocket) {
          const payload = typeof raw === 'string' ? raw : raw.toString();
          if (!proxyReady) {
            proxyQueue.push(payload);
            return;
          }
          proxySocket.send(payload);
          return;
        }

        if (!attachedSessionId) {
          sendError(socket, 'BROWSER_SESSION_REQUIRED', 'Attach to a browser session first');
          return;
        }

        if (parsed.sessionId !== attachedSessionId) {
          sendError(
            socket,
            'BROWSER_SESSION_MISMATCH',
            'Browser message session does not match the attached session',
          );
          return;
        }

        if (parsed.type === 'browser.heartbeat') {
          void manager.heartbeat(attachedSessionId).catch(() => undefined);
          return;
        }

        void manager
          .handleClientEvent(
            attachedSessionId,
            viewerId,
            parsed as Exclude<
              BrowserClientEvent,
              BrowserAttachRequestEvent | { type: 'browser.heartbeat' }
            >,
          )
          .catch((error) => {
            sendError(
              socket,
              error instanceof Error && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'BROWSER_EVENT_FAILED',
              error instanceof Error ? error.message : 'Browser event failed',
              attachedSessionId ?? undefined,
            );
          });
      });

      socket.on('close', () => {
        clearLocalDetach();
        clearProxySocket();
      });
    },
  );

  app.get(
    '/browser/internal',
    { websocket: true },
    async (socket: WebSocket, request) => {
      try {
        assertInternalServiceSecret(getInternalSecret(request.raw.url));
      } catch {
        socket.close(1008, 'Internal authentication failed');
        return;
      }

      const manager = getBrowserSessionManager();
      const viewerId = crypto.randomUUID();
      let detach: (() => void) | null = null;
      let attachedSessionId: string | null = null;

      socket.binaryType = 'arraybuffer';

      socket.on('message', (raw) => {
        if (!(typeof raw === 'string' || raw instanceof Buffer)) {
          return;
        }

        const text = raw.toString();
        let parsed: BrowserClientEvent;
        try {
          parsed = JSON.parse(text) as BrowserClientEvent;
        } catch {
          sendError(socket, 'BROWSER_INVALID_MESSAGE', 'Invalid browser websocket message');
          return;
        }

        if (isAttachEvent(parsed)) {
          detach?.();
          detach = null;
          attachedSessionId = parsed.sessionId;
          void attachLocalSession(socket, {
            manager,
            sessionId: parsed.sessionId,
            viewerId,
            setDetach: (nextDetach) => {
              detach = nextDetach;
            },
          }).catch((error) => {
            logger.warn(
              {
                event: 'browser.ws.internal_attach_failed',
                outcome: 'failure',
                error,
                viewerId,
                sessionId: parsed.sessionId,
              },
              'Failed to attach internal browser websocket viewer',
            );
            sendError(socket, 'BROWSER_ATTACH_FAILED', 'Failed to attach browser session');
          });
          return;
        }

        if (!attachedSessionId) {
          sendError(socket, 'BROWSER_SESSION_REQUIRED', 'Attach to a browser session first');
          return;
        }

        if (parsed.sessionId !== attachedSessionId) {
          sendError(
            socket,
            'BROWSER_SESSION_MISMATCH',
            'Browser message session does not match the attached session',
          );
          return;
        }

        if (parsed.type === 'browser.heartbeat') {
          void manager.heartbeat(attachedSessionId).catch(() => undefined);
          return;
        }

        void manager
          .handleClientEvent(
            attachedSessionId,
            viewerId,
            parsed as Exclude<
              BrowserClientEvent,
              BrowserAttachRequestEvent | { type: 'browser.heartbeat' }
            >,
          )
          .catch((error) => {
            sendError(
              socket,
              error instanceof Error && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'BROWSER_EVENT_FAILED',
              error instanceof Error ? error.message : 'Browser event failed',
              attachedSessionId ?? undefined,
            );
          });
      });

      socket.on('close', () => {
        detach?.();
        detach = null;
      });
    },
  );
}
