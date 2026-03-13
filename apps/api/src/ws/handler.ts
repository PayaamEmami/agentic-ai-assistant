import type { FastifyInstance } from 'fastify';
import { conversationRepository } from '@aaa/db';
import type { RealtimeEvent } from '@aaa/shared';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import { extractBearerToken, authenticateToken, type AuthUser } from '../middleware/auth.js';
import { subscribe, unsubscribe } from './connections.js';

interface SubscribeMessage {
  type: 'subscribe';
  conversationId: string;
}

interface EventMessage {
  type: 'event';
  event: RealtimeEvent;
}

type IncomingWsMessage = SubscribeMessage | EventMessage;

function getQueryToken(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  const url = new URL(rawUrl, 'http://localhost');
  const token = url.searchParams.get('token');
  return token && token.trim().length > 0 ? token.trim() : null;
}

function sendSocketMessage(
  socket: WebSocket,
  payload: Record<string, unknown>,
): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    socket.close();
  }
}

function sendSocketError(
  socket: WebSocket,
  code: string,
  message: string,
): void {
  sendSocketMessage(socket, {
    type: 'error',
    error: { code, message },
  });
}

async function canSubscribeToConversation(
  user: AuthUser,
  conversationId: string,
): Promise<boolean> {
  const conversation = await conversationRepository.findById(conversationId);
  return conversation?.userId === user.id;
}

export async function wsHandler(app: FastifyInstance) {
  app.get(
    '/events',
    { websocket: true },
    async (socket: WebSocket, request) => {
      const token =
        getQueryToken(request.raw.url) ??
        extractBearerToken(request.headers.authorization);

      if (!token) {
        logger.warn('Rejected unauthenticated WebSocket connection');
        socket.close(1008, 'Authentication required');
        return;
      }

      let user: AuthUser;
      try {
        user = await authenticateToken(token);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Rejected invalid WebSocket token',
        );
        socket.close(1008, 'Authentication failed');
        return;
      }

      logger.info({ userId: user.id }, 'WebSocket client connected');
      const subscribedConversations = new Set<string>();

      socket.on('message', (rawData) => {
        const messageText = rawData.toString();
        void (async () => {
          let parsed: IncomingWsMessage;

          try {
            parsed = JSON.parse(messageText) as IncomingWsMessage;
          } catch {
            logger.warn({ messageText }, 'Invalid WebSocket message JSON');
            return;
          }

          if (parsed.type === 'subscribe') {
            if (!parsed.conversationId) {
              logger.warn({ messageText }, 'Missing conversationId in subscribe message');
              return;
            }

            const allowed = await canSubscribeToConversation(user, parsed.conversationId);
            if (!allowed) {
              logger.warn(
                { userId: user.id, conversationId: parsed.conversationId },
                'Rejected unauthorized WebSocket subscription',
              );
              sendSocketError(socket, 'FORBIDDEN', 'Conversation access denied');
              return;
            }

            subscribe(parsed.conversationId, socket);
            subscribedConversations.add(parsed.conversationId);
            sendSocketMessage(socket, {
              type: 'subscribed',
              conversationId: parsed.conversationId,
            });
            logger.debug(
              { userId: user.id, conversationId: parsed.conversationId },
              'WebSocket subscribed to conversation',
            );
            return;
          }

          logger.debug({ parsed }, 'Ignoring unsupported WebSocket event message');
        })().catch((error) => {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'Failed to process WebSocket message',
          );
        });
      });

      socket.on('close', () => {
        for (const conversationId of subscribedConversations) {
          unsubscribe(conversationId, socket);
        }
        logger.info({ userId: user.id }, 'WebSocket client disconnected');
      });
    },
  );
}
