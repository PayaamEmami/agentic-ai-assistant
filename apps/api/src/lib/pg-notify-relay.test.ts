import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aaa/db', () => ({
  getPool: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { createPgNotifyRelay, type PgNotifyClient } from './pg-notify-relay.js';

class FakeClient implements PgNotifyClient {
  readonly queryCalls: string[] = [];
  released = false;
  queryError: Error | null = null;
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  async query(sql: string): Promise<unknown> {
    this.queryCalls.push(sql);
    if (this.queryError) {
      throw this.queryError;
    }
    return undefined;
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(cb);
    this.listeners.set(event, existing);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.clear();
  }

  release(): void {
    this.released = true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function createHarness(options?: { onPayload?: (payload: unknown) => void }) {
  const clients: FakeClient[] = [];
  const pending = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimerId = 1;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  };
  const onPayload = options?.onPayload ?? vi.fn();

  const relay = createPgNotifyRelay({
    channel: 'tool_execution_events',
    component: 'tool-event-relay',
    eventPrefix: 'tool.event_relay',
    label: 'tool event relay',
    onPayload,
    connect: async () => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
    logger,
    timers: {
      setTimeout: (callback, delayMs) => {
        const id = nextTimerId;
        nextTimerId += 1;
        pending.set(id, { callback, delayMs });
        return id;
      },
      clearTimeout: (handle) => {
        pending.delete(handle as number);
      },
    },
    reconnectMinMs: 1_000,
    reconnectMaxMs: 4_000,
  });

  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  return {
    relay,
    clients,
    logger,
    onPayload,
    pending,
    flushMicrotasks,
    flushNextTimer() {
      const entry = pending.entries().next().value as
        | [number, { callback: () => void; delayMs: number }]
        | undefined;
      if (!entry) {
        throw new Error('No reconnect timer scheduled');
      }
      const [id, job] = entry;
      pending.delete(id);
      job.callback();
      return job.delayMs;
    },
  };
}

describe('createPgNotifyRelay', () => {
  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('rejects unsafe channel names before connecting', () => {
    expect(() =>
      createPgNotifyRelay({
        channel: 'tool_execution_events; DROP TABLE users',
        component: 'tool-event-relay',
        eventPrefix: 'tool.event_relay',
        label: 'tool event relay',
        onPayload: () => undefined,
      }),
    ).toThrow(/Invalid Postgres NOTIFY channel/);
  });

  it('listens and forwards parsed payloads', async () => {
    const harness = createHarness();
    await harness.relay.start();

    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]!.queryCalls).toEqual(['LISTEN tool_execution_events']);
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.started' }),
      'Tool event relay started',
    );

    harness.clients[0]!.emit('notification', {
      channel: 'tool_execution_events',
      payload: JSON.stringify({ type: 'tool.start', conversationId: 'c1' }),
    });

    expect(harness.onPayload).toHaveBeenCalledWith({
      type: 'tool.start',
      conversationId: 'c1',
    });
  });

  it('ignores notifications for other channels or empty payloads', async () => {
    const harness = createHarness();
    await harness.relay.start();

    harness.clients[0]!.emit('notification', {
      channel: 'other',
      payload: JSON.stringify({ type: 'ignored' }),
    });
    harness.clients[0]!.emit('notification', {
      channel: 'tool_execution_events',
    });

    expect(harness.onPayload).not.toHaveBeenCalled();
  });

  it('logs invalid JSON without throwing', async () => {
    const harness = createHarness();
    await harness.relay.start();

    harness.clients[0]!.emit('notification', {
      channel: 'tool_execution_events',
      payload: '{not-json',
    });

    expect(harness.onPayload).not.toHaveBeenCalled();
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.notification_failed' }),
      'Failed to process tool event relay notification',
    );
  });

  it('logs handler failures without throwing', async () => {
    const harness = createHarness({
      onPayload: () => {
        throw new Error('broadcast failed');
      },
    });
    await harness.relay.start();

    harness.clients[0]!.emit('notification', {
      channel: 'tool_execution_events',
      payload: JSON.stringify({ ok: true }),
    });

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.notification_failed' }),
      'Failed to process tool event relay notification',
    );
  });

  it('is a no-op when start is called while already connected', async () => {
    const harness = createHarness();
    await harness.relay.start();
    await harness.relay.start();
    expect(harness.clients).toHaveLength(1);
  });

  it('reconnects after the LISTEN socket drops and resets backoff on success', async () => {
    const harness = createHarness();
    await harness.relay.start();

    harness.clients[0]!.emit('error');
    expect(harness.clients[0]!.released).toBe(true);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.disconnected' }),
      'Tool event relay disconnected; retrying',
    );

    const firstDelay = harness.flushNextTimer();
    expect(firstDelay).toBe(1_000);
    await harness.flushMicrotasks();
    expect(harness.clients).toHaveLength(2);
    expect(harness.clients[1]!.queryCalls).toEqual(['LISTEN tool_execution_events']);

    harness.clients[1]!.emit('end');
    const secondDelay = harness.flushNextTimer();
    expect(secondDelay).toBe(1_000);
  });

  it('retries a failed start with exponential backoff', async () => {
    const clients: FakeClient[] = [];
    const pending = new Map<number, { callback: () => void; delayMs: number }>();
    let nextTimerId = 1;
    let attempts = 0;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const failingRelay = createPgNotifyRelay({
      channel: 'tool_execution_events',
      component: 'tool-event-relay',
      eventPrefix: 'tool.event_relay',
      label: 'tool event relay',
      onPayload: vi.fn(),
      connect: async () => {
        attempts += 1;
        const client = new FakeClient();
        clients.push(client);
        if (attempts < 3) {
          client.queryError = new Error('LISTEN failed');
        }
        return client;
      },
      logger,
      timers: {
        setTimeout: (callback, delayMs) => {
          const id = nextTimerId;
          nextTimerId += 1;
          pending.set(id, { callback, delayMs });
          return id;
        },
        clearTimeout: (handle) => {
          pending.delete(handle as number);
        },
      },
      reconnectMinMs: 1_000,
      reconnectMaxMs: 4_000,
    });

    await failingRelay.start();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.start_failed' }),
      'Failed to start the tool event relay; retrying',
    );
    expect(clients[0]!.released).toBe(true);

    const first = pending.entries().next().value as
      | [number, { callback: () => void; delayMs: number }]
      | undefined;
    expect(first?.[1].delayMs).toBe(1_000);
    pending.delete(first![0]);
    first![1].callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.reconnect_failed' }),
      'Failed to reconnect the tool event relay',
    );

    const second = pending.entries().next().value as
      | [number, { callback: () => void; delayMs: number }]
      | undefined;
    expect(second?.[1].delayMs).toBe(2_000);
    pending.delete(second![0]);
    second![1].callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toBe(3);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.started' }),
      'Tool event relay started',
    );

    await failingRelay.stop();
  });

  it('unlistens on stop and does not reconnect afterward', async () => {
    const harness = createHarness();
    await harness.relay.start();
    await harness.relay.stop();

    expect(harness.clients[0]!.queryCalls).toContain('UNLISTEN tool_execution_events');
    expect(harness.clients[0]!.released).toBe(true);
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tool.event_relay.stopped' }),
      'Tool event relay stopped',
    );

    harness.clients[0]!.emit('end');
    expect(harness.pending.size).toBe(0);
  });
});
