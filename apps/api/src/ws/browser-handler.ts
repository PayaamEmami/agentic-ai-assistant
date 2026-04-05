import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { mcpBrowserSessionRepository } from '@aaa/db';
import type {
  BrowserAttachRequestEvent,
  BrowserClientEvent,
  BrowserControlStateEvent,
  BrowserErrorEvent,
  BrowserSessionAttachedEvent,
  BrowserServerEvent,
} from '@aaa/shared';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
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

async function authenticateSocket(token: string | null): Promise<AuthUser> {
  if (!token) {
    throw new Error('Authentication required');
  }
  return authenticateToken(token);
}

export async function browserWsHandler(app: FastifyInstance) {
  app.get(
    '/browser',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const viewerId = crypto.randomUUID();
      const token =
        getQueryToken(request.raw.url) ?? extractBearerToken(request.headers.authorization);

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
          void (async () => {
            const session = await mcpBrowserSessionRepository.findById(parsed.sessionId);
            if (!session || session.userId !== user.id) {
              sendError(socket, 'BROWSER_SESSION_NOT_FOUND', 'Browser session not found');
              return;
            }

            if (detach) {
              detach();
              detach = null;
            }

            attachedSessionId = session.id;
            detach = manager.subscribe(session.id, viewerId, {
              onServerEvent: (event) => {
                sendJson(socket, event);
              },
              onFrame: ({ meta, buffer }) => {
                if (socket.readyState !== 1) {
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
            await manager.heartbeat(session.id);
            const snapshot = await manager.getSnapshot(session.id);
            const attachedPayload: BrowserSessionAttachedEvent = {
              type: 'browser.session.attached',
              sessionId: snapshot.sessionId,
              mcpConnectionId: snapshot.mcpConnectionId,
              status: snapshot.status,
              purpose: snapshot.purpose,
              selectedPageId: snapshot.selectedPageId,
              controlGranted: manager.hasControl(session.id, viewerId),
              pages: snapshot.pages,
              viewport: snapshot.viewport,
            };
            sendJson(socket, attachedPayload);
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

        if (!attachedSessionId) {
          sendError(socket, 'BROWSER_SESSION_REQUIRED', 'Attach to a browser session first');
          return;
        }

        if (parsed.sessionId !== attachedSessionId) {
          sendError(socket, 'BROWSER_SESSION_MISMATCH', 'Browser message session does not match the attached session');
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
