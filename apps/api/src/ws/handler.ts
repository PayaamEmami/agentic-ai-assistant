import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { logger } from '../lib/logger.js';

export async function wsHandler(app: FastifyInstance) {
  app.get(
    '/events',
    { websocket: true },
    (socket: WebSocket, _request) => {
      logger.info('WebSocket client connected');

      socket.on('message', (data: Buffer) => {
        // TODO: handle incoming WebSocket messages (subscribe to conversation events, etc.)
        const message = data.toString();
        logger.debug({ message }, 'WebSocket message received');
      });

      socket.on('close', () => {
        logger.info('WebSocket client disconnected');
      });
    },
  );
}
