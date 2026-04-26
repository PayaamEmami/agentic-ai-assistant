import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withLogContext, withSpan } from '@aaa/observability';
import { conversationRepository } from '@aaa/db';
import type { RealtimeEvent } from '@aaa/shared';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
import {
  websocketConnections,
  websocketMessagesTotal,
  websocketSubscriptionsTotal,
} from '../lib/telemetry.js';
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

function sendSocketMessage(socket: WebSocket, payload: Record<string, unknown>): void {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    socket.close();
  }
}

function sendSocketError(socket: WebSocket, code: string, message: string): void {
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
  app.get('/events', { websocket: true }, async (socket: WebSocket, request) => {
    const wsConnectionId = crypto.randomUUID();
    const queryParams = getQueryParams(request.raw.url);
    const correlationId = queryParams?.get('correlationId')?.trim() || request.id;
    const token =
      getQueryToken(request.raw.url) ?? extractBearerToken(request.headers.authorization);

    if (!token) {
      logger.warn(
        {
          event: 'ws.connection.rejected',
          outcome: 'failure',
          component: 'ws-handler',
          reason: 'missing_token',
        },
        'Rejected unauthenticated WebSocket connection',
      );
      socket.close(1008, 'Authentication required');
      return;
    }

    let user: AuthUser;
    try {
      user = await authenticateToken(token);
    } catch (error) {
      logger.warn(
        {
          event: 'ws.connection.rejected',
          outcome: 'failure',
          component: 'ws-handler',
          error,
        },
        'Rejected invalid WebSocket token',
      );
      socket.close(1008, 'Authentication failed');
      return;
    }

    logger.info(
      {
        event: 'ws.connection.accepted',
        outcome: 'success',
        component: 'ws-handler',
        correlationId,
        wsConnectionId,
        userId: user.id,
      },
      'WebSocket client connected',
    );
    websocketConnections.inc({ state: 'open' });
    const subscribedConversations = new Set<string>();

    socket.on('message', (rawData) => {
      const messageText = rawData.toString();
      void withLogContext(
        {
          component: 'ws-handler',
          correlationId,
          wsConnectionId,
          userId: user.id,
        },
        () =>
          withSpan(
            'ws.message.process',
            {
              'aaa.ws.connection_id': wsConnectionId,
              'aaa.correlation_id': correlationId,
              'enduser.id': user.id,
            },
            async () => {
              websocketMessagesTotal.inc({ direction: 'inbound', outcome: 'received' });
              let parsed: IncomingWsMessage;

              try {
                parsed = JSON.parse(messageText) as IncomingWsMessage;
              } catch {
                websocketMessagesTotal.inc({ direction: 'inbound', outcome: 'rejected' });
                logger.warn(
                  {
                    event: 'ws.message.rejected',
                    outcome: 'failure',
                  },
                  'Invalid WebSocket message JSON',
                );
                return;
              }

              if (parsed.type === 'subscribe') {
                if (!parsed.conversationId) {
                  websocketSubscriptionsTotal.inc({ outcome: 'rejected' });
                  logger.warn(
                    {
                      event: 'ws.subscription.rejected',
                      outcome: 'failure',
                      reason: 'missing_conversation_id',
                    },
                    'Missing conversationId in subscribe message',
                  );
                  return;
                }

                const allowed = await canSubscribeToConversation(user, parsed.conversationId);
                if (!allowed) {
                  websocketSubscriptionsTotal.inc({ outcome: 'rejected' });
                  logger.warn(
                    {
                      event: 'ws.subscription.rejected',
                      outcome: 'failure',
                      conversationId: parsed.conversationId,
                    },
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
                websocketSubscriptionsTotal.inc({ outcome: 'accepted' });
                websocketMessagesTotal.inc({ direction: 'outbound', outcome: 'sent' });
                logger.debug(
                  {
                    event: 'ws.subscription.accepted',
                    outcome: 'success',
                    conversationId: parsed.conversationId,
                  },
                  'WebSocket subscribed to conversation',
                );
                return;
              }

              logger.debug(
                {
                  event: 'ws.message.ignored',
                  outcome: 'success',
                  messageType: parsed.type,
                },
                'Ignoring unsupported WebSocket event message',
              );
            },
          ),
      ).catch((error) => {
        websocketMessagesTotal.inc({ direction: 'inbound', outcome: 'failed' });
        logger.warn(
          {
            event: 'ws.message.failed',
            outcome: 'failure',
            component: 'ws-handler',
            correlationId,
            wsConnectionId,
            userId: user.id,
            error,
          },
          'Failed to process WebSocket message',
        );
      });
    });

    socket.on('close', () => {
      for (const conversationId of subscribedConversations) {
        unsubscribe(conversationId, socket);
      }
      websocketConnections.dec({ state: 'open' });
      logger.info(
        {
          event: 'ws.connection.closed',
          outcome: 'success',
          component: 'ws-handler',
          correlationId,
          wsConnectionId,
          userId: user.id,
        },
        'WebSocket client disconnected',
      );
    });
  });
}
