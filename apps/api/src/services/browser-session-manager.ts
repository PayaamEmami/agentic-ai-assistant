import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import {
  mcpBrowserSessionRepository,
  messageRepository,
  type McpBrowserSession,
  type McpProfile,
} from '@aaa/db';
import { decryptCredentials } from '@aaa/knowledge-sources';
import { getLogger } from '@aaa/observability';
import type {
  BrowserClientEvent,
  BrowserFrameMetaEvent,
  BrowserPageEvent,
  BrowserServerEvent,
  BrowserSessionEndedEvent,
  BrowserSessionUpdatedEvent,
} from '@aaa/shared';
import {
  browserFrameBytesTotal,
  browserFramesTotal,
  browserInputEventsTotal,
  browserSessionsActive,
  browserSessionsTotal,
} from '../lib/telemetry.js';
import { AppError } from '../lib/errors.js';
import { getApiInstanceId } from '../lib/internal-service.js';
import { buildBrowserSessionContentPatch } from './browser-session-content.js';

const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

type SessionTerminalStatus = 'completed' | 'cancelled' | 'expired' | 'failed' | 'crashed';

interface BrowserSessionSnapshot {
  sessionId: string;
  mcpProfileId: string;
  purpose: McpBrowserSession['purpose'];
  status: McpBrowserSession['status'];
  selectedPageId: string | null;
  pages: BrowserPageEvent[];
  viewport: { width: number; height: number } | null;
}

interface FrameEventPayload {
  meta: BrowserFrameMetaEvent;
  buffer: Buffer;
}

interface ControlChangedPayload {
  viewerId: string | null;
}

interface LiveBrowserSession {
  sessionId: string;
  userId: string;
  mcpProfileId: string;
  messageId: string | null;
  purpose: McpBrowserSession['purpose'];
  metadata: Record<string, unknown>;
  browser: Browser;
  context: BrowserContext;
  emitter: EventEmitter;
  pages: Map<string, Page>;
  pageIds: WeakMap<Page, string>;
  selectedPageId: string | null;
  screencastClient: CDPSession | null;
  viewport: { width: number; height: number } | null;
  expiresAt: number;
  lastClientSeenAt: number;
  lastFrameAt: number | null;
  lastPersistedFrameAt: number;
  viewers: Set<string>;
  controlViewerId: string | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function getStorageState(profile: McpProfile): Record<string, unknown> | undefined {
  const credentials = decryptCredentials(profile.encryptedCredentials);
  const state = credentials['storageState'];
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    return state as Record<string, unknown>;
  }
  return undefined;
}

async function getPageTitle(page: Page): Promise<string> {
  try {
    const title = await page.title();
    return title.trim().length > 0 ? title : page.url() || 'New tab';
  } catch {
    return page.url() || 'New tab';
  }
}

export class BrowserSessionManager {
  private readonly logger = getLogger({ component: 'browser-session-manager' });
  private readonly liveSessions = new Map<string, LiveBrowserSession>();
  private initialized = false;
  private sweepInterval: NodeJS.Timeout | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    const crashedCount = await mcpBrowserSessionRepository.markActiveAsCrashed(
      getApiInstanceId(),
    );
    if (crashedCount > 0) {
      browserSessionsTotal.inc({ action: 'recover', outcome: 'crashed' }, crashedCount);
    }

    this.sweepInterval = setInterval(() => {
      void this.sweepExpiredSessions();
    }, 15_000);
    this.sweepInterval.unref();
  }

  async createSession(
    session: McpBrowserSession,
    profile: McpProfile,
    input: { startUrl?: string },
  ): Promise<BrowserSessionSnapshot> {
    await this.initialize();

    const storageState = getStorageState(profile);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(
      storageState
        ? {
            storageState: storageState as never,
            viewport: DEFAULT_VIEWPORT,
          }
        : {
            viewport: DEFAULT_VIEWPORT,
          },
    );

    const live: LiveBrowserSession = {
      sessionId: session.id,
      userId: session.userId,
      mcpProfileId: session.mcpProfileId,
      messageId: session.messageId,
      purpose: session.purpose,
      metadata: { ...session.metadata },
      browser,
      context,
      emitter: new EventEmitter(),
      pages: new Map(),
      pageIds: new WeakMap(),
      selectedPageId: null,
      screencastClient: null,
      viewport: { ...DEFAULT_VIEWPORT },
      expiresAt: session.expiresAt.getTime(),
      lastClientSeenAt: Date.now(),
      lastFrameAt: null,
      lastPersistedFrameAt: 0,
      viewers: new Set(),
      controlViewerId: null,
    };

    this.liveSessions.set(session.id, live);
    browserSessionsActive.inc({ state: 'active' });
    browserSessionsTotal.inc({ action: 'create', outcome: 'success' });

    context.on('page', (page: Page) => {
      void this.registerPage(live, page, true);
    });
    context.on('close', () => {
      void this.finishSession(live.sessionId, 'crashed', 'browser_context_closed');
    });
    browser.on('disconnected', () => {
      void this.finishSession(live.sessionId, 'crashed', 'browser_disconnected');
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await this.registerPage(live, page, false);
    const initialPage = this.getSelectedPage(live) ?? page;

    const startUrl = asString(input.startUrl);
    if (startUrl) {
      await initialPage.goto(startUrl, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    } else {
      await initialPage.goto('about:blank').catch(() => undefined);
    }

    await this.startSelectedPageScreencast(live);
    await mcpBrowserSessionRepository.update(session.id, {
      status: 'active',
      selectedPageId: live.selectedPageId,
      metadata: {
        ...live.metadata,
        startUrl: startUrl ? sanitizeUrl(startUrl) : 'about:blank',
      },
    });
    live.metadata = {
      ...live.metadata,
      startUrl: startUrl ? sanitizeUrl(startUrl) : 'about:blank',
    };

    return this.getSnapshot(session.id);
  }

  hasLiveSession(sessionId: string): boolean {
    return this.liveSessions.has(sessionId);
  }

  async getSnapshot(sessionId: string): Promise<BrowserSessionSnapshot> {
    const live = this.requireLiveSession(sessionId);
    return {
      sessionId: live.sessionId,
      mcpProfileId: live.mcpProfileId,
      purpose: live.purpose,
      status: 'active',
      selectedPageId: live.selectedPageId,
      pages: await Promise.all(
        Array.from(live.pages.entries()).map(async ([pageId, page]) => ({
          pageId,
          url: page.url(),
          title: await getPageTitle(page),
          isSelected: live.selectedPageId === pageId,
        })),
      ),
      viewport: live.viewport,
    };
  }

  subscribe(
    sessionId: string,
    viewerId: string,
    listener: {
      onServerEvent: (event: BrowserServerEvent) => void;
      onFrame: (frame: FrameEventPayload) => void;
      onControlChanged: (viewerId: string | null) => void;
    },
  ): () => void {
    const live = this.requireLiveSession(sessionId);
    live.viewers.add(viewerId);
    live.lastClientSeenAt = Date.now();
    if (!live.controlViewerId) {
      live.controlViewerId = viewerId;
    }

    const serverEventHandler = (event: BrowserServerEvent) => listener.onServerEvent(event);
    const frameHandler = (frame: FrameEventPayload) => listener.onFrame(frame);
    const controlHandler = (payload: ControlChangedPayload) =>
      listener.onControlChanged(payload.viewerId);

    live.emitter.on('serverEvent', serverEventHandler);
    live.emitter.on('frame', frameHandler);
    live.emitter.on('controlChanged', controlHandler);

    return () => {
      live.emitter.off('serverEvent', serverEventHandler);
      live.emitter.off('frame', frameHandler);
      live.emitter.off('controlChanged', controlHandler);
      live.viewers.delete(viewerId);
      if (live.controlViewerId === viewerId) {
        live.controlViewerId = live.viewers.values().next().value ?? null;
        live.emitter.emit('controlChanged', { viewerId: live.controlViewerId });
      }
    };
  }

  async heartbeat(sessionId: string): Promise<void> {
    const live = this.requireLiveSession(sessionId);
    live.lastClientSeenAt = Date.now();
    await mcpBrowserSessionRepository.update(sessionId, {
      lastClientSeenAt: new Date(live.lastClientSeenAt),
    });
  }

  hasControl(sessionId: string, viewerId: string): boolean {
    const live = this.requireLiveSession(sessionId);
    return live.controlViewerId === viewerId;
  }

  async handleClientEvent(
    sessionId: string,
    viewerId: string,
    event: Exclude<BrowserClientEvent, { type: 'browser.attach' } | { type: 'browser.heartbeat' }>,
  ): Promise<void> {
    const live = this.requireLiveSession(sessionId);
    if (live.controlViewerId !== viewerId) {
      browserInputEventsTotal.inc({ input_type: event.type, outcome: 'rejected' });
      throw new AppError(409, 'This viewer does not have browser control', 'BROWSER_CONTROL_DENIED');
    }

    const page = this.getSelectedPage(live);
    if (!page) {
      browserInputEventsTotal.inc({ input_type: event.type, outcome: 'failed' });
      throw new AppError(409, 'No browser page is available', 'BROWSER_PAGE_UNAVAILABLE');
    }

    switch (event.type) {
      case 'browser.resize': {
        live.viewport = { width: event.width, height: event.height };
        await page.setViewportSize(live.viewport);
        await this.emitSnapshot(live);
        break;
      }
      case 'browser.navigate':
        await page.goto(event.url, { waitUntil: 'domcontentloaded' });
        await this.emitSnapshot(live);
        break;
      case 'browser.page.select':
        await this.selectPage(live, event.pageId);
        break;
      case 'browser.history':
        if (event.action === 'back') {
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
        } else if (event.action === 'forward') {
          await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
        } else {
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
        }
        await this.emitSnapshot(live);
        break;
      case 'browser.pointer':
        if (event.action === 'move') {
          await page.mouse.move(event.x, event.y);
        } else if (event.action === 'down') {
          await page.mouse.move(event.x, event.y);
          await page.mouse.down({ button: event.button ?? 'left' });
        } else {
          await page.mouse.move(event.x, event.y);
          await page.mouse.up({ button: event.button ?? 'left' });
        }
        break;
      case 'browser.wheel':
        await page.mouse.move(event.x, event.y);
        await page.mouse.wheel(event.deltaX, event.deltaY);
        break;
      case 'browser.keyboard':
        if (event.action === 'down') {
          await page.keyboard.down(event.key);
        } else if (event.action === 'up') {
          await page.keyboard.up(event.key);
        } else {
          await page.keyboard.press(event.key);
        }
        break;
      default:
        break;
    }

    browserInputEventsTotal.inc({ input_type: event.type, outcome: 'success' });
  }

  async persistSession(sessionId: string): Promise<Record<string, unknown>> {
    const live = this.requireLiveSession(sessionId);
    const storageState = (await live.context.storageState()) as unknown as Record<string, unknown>;
    await this.finishSession(sessionId, 'completed', 'persisted_by_user');
    return storageState;
  }

  async cancelSession(sessionId: string, reason = 'cancelled_by_user'): Promise<void> {
    await this.finishSession(sessionId, 'cancelled', reason);
  }

  async expireSession(sessionId: string, reason = 'session_expired'): Promise<void> {
    await this.finishSession(sessionId, 'expired', reason);
  }

  async failSession(sessionId: string, reason: string): Promise<void> {
    await this.finishSession(sessionId, 'failed', reason);
  }

  async shutdown(): Promise<void> {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }

    const sessionIds = Array.from(this.liveSessions.keys());
    await Promise.all(sessionIds.map((sessionId) => this.finishSession(sessionId, 'crashed', 'api_shutdown')));
  }

  private requireLiveSession(sessionId: string): LiveBrowserSession {
    const live = this.liveSessions.get(sessionId);
    if (!live) {
      throw new AppError(404, 'Browser session is not live on this API instance', 'BROWSER_SESSION_NOT_LIVE');
    }
    return live;
  }

  private getSelectedPage(live: LiveBrowserSession): Page | null {
    return live.selectedPageId ? (live.pages.get(live.selectedPageId) ?? null) : null;
  }

  private async registerPage(live: LiveBrowserSession, page: Page, autoSelect: boolean): Promise<void> {
    let pageId = live.pageIds.get(page);
    if (!pageId) {
      pageId = crypto.randomUUID();
      live.pageIds.set(page, pageId);
      live.pages.set(pageId, page);
    }

    page.on('framenavigated', () => {
      void this.emitSnapshot(live);
    });
    page.on('load', () => {
      void this.emitSnapshot(live);
    });
    page.on('close', () => {
      const id = live.pageIds.get(page);
      if (!id) {
        return;
      }
      live.pages.delete(id);
      if (live.selectedPageId === id) {
        live.selectedPageId = live.pages.keys().next().value ?? null;
        void this.startSelectedPageScreencast(live).catch(() => undefined);
      }
      void this.emitSnapshot(live);
    });

    if (!live.selectedPageId || autoSelect) {
      await this.selectPage(live, pageId);
      return;
    }

    await this.emitSnapshot(live);
  }

  private async selectPage(live: LiveBrowserSession, pageId: string): Promise<void> {
    if (!live.pages.has(pageId)) {
      throw new AppError(404, 'Browser page not found', 'BROWSER_PAGE_NOT_FOUND');
    }
    live.selectedPageId = pageId;
    await mcpBrowserSessionRepository.update(live.sessionId, { selectedPageId: pageId });
    await this.startSelectedPageScreencast(live);
    await this.emitSnapshot(live);
  }

  private async startSelectedPageScreencast(live: LiveBrowserSession): Promise<void> {
    if (live.screencastClient) {
      await live.screencastClient.send('Page.stopScreencast').catch(() => undefined);
      live.screencastClient.detach().catch(() => undefined);
      live.screencastClient = null;
    }

    const page = this.getSelectedPage(live);
    if (!page) {
      return;
    }

    const client = await live.context.newCDPSession(page);
    live.screencastClient = client;
    await client.send('Page.enable').catch(() => undefined);
    client.on('Page.screencastFrame', (payload: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }) => {
      const buffer = Buffer.from(payload.data, 'base64');
      const width = Math.round(payload.metadata?.deviceWidth ?? live.viewport?.width ?? DEFAULT_VIEWPORT.width);
      const height = Math.round(payload.metadata?.deviceHeight ?? live.viewport?.height ?? DEFAULT_VIEWPORT.height);
      const meta: BrowserFrameMetaEvent = {
        type: 'browser.frame.meta',
        sessionId: live.sessionId,
        pageId: live.selectedPageId ?? '',
        mimeType: 'image/jpeg',
        width,
        height,
        timestamp: new Date().toISOString(),
      };

      live.lastFrameAt = Date.now();
      if (live.lastFrameAt - live.lastPersistedFrameAt > 2000) {
        live.lastPersistedFrameAt = live.lastFrameAt;
        void mcpBrowserSessionRepository.update(live.sessionId, {
          lastFrameAt: new Date(live.lastFrameAt),
        });
      }

      browserFramesTotal.inc({ outcome: 'sent' });
      browserFrameBytesTotal.inc(buffer.byteLength);
      live.emitter.emit('frame', { meta, buffer });
      void client.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => undefined);
    });
    await client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: live.viewport?.width ?? DEFAULT_VIEWPORT.width,
      maxHeight: live.viewport?.height ?? DEFAULT_VIEWPORT.height,
      everyNthFrame: 1,
    }).catch((error: unknown) => {
      browserFramesTotal.inc({ outcome: 'failed' });
      this.logger.warn(
        {
          event: 'browser.screencast.start_failed',
          outcome: 'failure',
          sessionId: live.sessionId,
          error,
        },
        'Failed to start browser screencast',
      );
    });
  }

  private async emitSnapshot(live: LiveBrowserSession): Promise<void> {
    const event: BrowserSessionUpdatedEvent = {
      type: 'browser.session.updated',
      sessionId: live.sessionId,
      status: 'active',
      selectedPageId: live.selectedPageId,
      pages: await Promise.all(
        Array.from(live.pages.entries()).map(async ([pageId, page]) => ({
          pageId,
          url: page.url(),
          title: await getPageTitle(page),
          isSelected: live.selectedPageId === pageId,
        })),
      ),
      viewport: live.viewport,
    };
    live.emitter.emit('serverEvent', event);
  }

  private async finishSession(
    sessionId: string,
    status: SessionTerminalStatus,
    reason: string,
  ): Promise<void> {
    const live = this.liveSessions.get(sessionId);
    if (!live) {
      const existing = await mcpBrowserSessionRepository.findById(sessionId);
      const updated = await mcpBrowserSessionRepository.update(sessionId, {
        status,
        endedAt: new Date(),
        metadata: {
          ...(existing?.metadata ?? {}),
          terminalReason: reason,
        },
      });
      if (updated?.messageId) {
        await messageRepository.updateBrowserSessionBlock(
          updated.messageId,
          updated.id,
          buildBrowserSessionContentPatch(updated),
        );
      }
      return;
    }

    this.liveSessions.delete(sessionId);
    browserSessionsActive.dec({ state: 'active' });
    browserSessionsTotal.inc({ action: 'end', outcome: status });

    const updated = await mcpBrowserSessionRepository.update(sessionId, {
      status,
      endedAt: new Date(),
      metadata: {
        ...live.metadata,
        terminalReason: reason,
      },
      lastClientSeenAt: new Date(live.lastClientSeenAt),
      lastFrameAt: live.lastFrameAt ? new Date(live.lastFrameAt) : null,
    });
    if (updated?.messageId) {
      await messageRepository.updateBrowserSessionBlock(
        updated.messageId,
        updated.id,
        buildBrowserSessionContentPatch(updated),
      );
    }

    const endEvent: BrowserSessionEndedEvent = {
      type: 'browser.session.ended',
      sessionId,
      status,
      reason,
    };
    live.emitter.emit('serverEvent', endEvent);

    await live.screencastClient?.send('Page.stopScreencast').catch(() => undefined);
    await live.screencastClient?.detach().catch(() => undefined);
    await live.context.close().catch(() => undefined);
    await live.browser.close().catch(() => undefined);
  }

  private async sweepExpiredSessions(): Promise<void> {
    const now = Date.now();
    await Promise.all(
      Array.from(this.liveSessions.values()).map(async (live) => {
        if (live.expiresAt <= now) {
          await this.finishSession(live.sessionId, 'expired', 'ttl_elapsed');
          return;
        }

        if (live.lastClientSeenAt + SESSION_IDLE_TIMEOUT_MS <= now) {
          await this.finishSession(live.sessionId, 'expired', 'viewer_heartbeat_timeout');
        }
      }),
    );
  }
}

let browserSessionManager: BrowserSessionManager | null = null;

export function getBrowserSessionManager(): BrowserSessionManager {
  if (!browserSessionManager) {
    browserSessionManager = new BrowserSessionManager();
  }
  return browserSessionManager;
}

export async function closeBrowserSessionManager(): Promise<void> {
  if (!browserSessionManager) {
    return;
  }
  const current = browserSessionManager;
  browserSessionManager = null;
  await current.shutdown();
}
