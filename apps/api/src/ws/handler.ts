import type { FastifyInstance } from 'fastify';
import type { RealtimeEvent } from '@aaa/shared';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';
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

export async function wsHandler(app: FastifyInstance) {
  app.get(
    '/events',
    { websocket: true },
    (socket: WebSocket, _request) => {
      logger.info('WebSocket client connected');
      const subscribedConversations = new Set<string>();

      socket.on('message', (rawData) => {
        const messageText = rawData.toString();
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

          subscribe(parsed.conversationId, socket);
          subscribedConversations.add(parsed.conversationId);
          logger.debug(
            { conversationId: parsed.conversationId },
            'WebSocket subscribed to conversation',
          );
          return;
        }

        logger.debug({ parsed }, 'Ignoring unsupported WebSocket event message');
      });

      socket.on('close', () => {
        for (const conversationId of subscribedConversations) {
          unsubscribe(conversationId, socket);
        }
        logger.info('WebSocket client disconnected');
      });
    },
  );
}
