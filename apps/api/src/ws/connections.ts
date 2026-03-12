import type { RealtimeEvent } from '@aaa/shared';
import type { WebSocket } from 'ws';

const OPEN_READY_STATE = 1;
const subscriptions = new Map<string, Set<WebSocket>>();
const socketsWithCleanup = new WeakSet<WebSocket>();

function cleanupSocket(socket: WebSocket): void {
  for (const [conversationId, sockets] of subscriptions.entries()) {
    sockets.delete(socket);
    if (sockets.size === 0) {
      subscriptions.delete(conversationId);
    }
  }
}

export function subscribe(conversationId: string, socket: WebSocket): void {
  let sockets = subscriptions.get(conversationId);
  if (!sockets) {
    sockets = new Set<WebSocket>();
    subscriptions.set(conversationId, sockets);
  }

  sockets.add(socket);
  if (!socketsWithCleanup.has(socket)) {
    socketsWithCleanup.add(socket);
    socket.once('close', () => {
      cleanupSocket(socket);
    });
  }
}

export function unsubscribe(conversationId: string, socket: WebSocket): void {
  const sockets = subscriptions.get(conversationId);
  if (!sockets) {
    return;
  }

  sockets.delete(socket);
  if (sockets.size === 0) {
    subscriptions.delete(conversationId);
  }
}

export function broadcast(conversationId: string, event: RealtimeEvent): void {
  const sockets = subscriptions.get(conversationId);
  if (!sockets || sockets.size === 0) {
    return;
  }

  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState !== OPEN_READY_STATE) {
      continue;
    }

    try {
      socket.send(payload);
    } catch {
      cleanupSocket(socket);
    }
  }
}
