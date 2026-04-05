import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { getLogger } from '@aaa/observability';
import type {
  ManualAuthSessionCompleteResult,
  ManualAuthSessionStartResult,
  RuntimeMcpConnection,
  ToolExecutionInput,
  ToolExecutionOutput,
  UnifiedToolDescriptor,
} from './types.js';

interface SecretProfile {
  url?: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

interface AuthSessionHandle {
  context: BrowserContext;
  userDataDir: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getSecretProfiles(credentials: Record<string, unknown>): Record<string, SecretProfile> {
  const value = credentials['secretProfiles'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, rawProfile]) => [
      key,
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? (rawProfile as SecretProfile)
        : {},
    ]),
  );
}

function getStorageState(credentials: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = credentials['storageState'];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function gotoIfProvided(page: Page, input: Record<string, unknown>): Promise<void> {
  const url = asString(input['url']);
  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}

async function createIsolatedContext(connection: RuntimeMcpConnection): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });
  const storageState = getStorageState(connection.credentials);
  const context = await browser.newContext(storageState ? { storageState: storageState as never } : undefined);
  context.on('close', async () => {
    await browser.close().catch(() => undefined);
  });
  return context;
}

function withUpdatedStorageState(
  connection: RuntimeMcpConnection,
  storageState: Record<string, unknown>,
): ToolExecutionOutput['connectionUpdate'] {
  return {
    credentials: {
      ...connection.credentials,
      storageState,
    },
  };
}

export class PlaywrightConnectionClient {
  private connection: RuntimeMcpConnection;
  private readonly logger = getLogger({ component: 'mcp-playwright' });
  private readonly authSessions = new Map<string, AuthSessionHandle>();

  constructor(connection: RuntimeMcpConnection) {
    this.connection = connection;
  }

  updateConnection(connection: RuntimeMcpConnection): void {
    this.connection = connection;
  }

  listTools(): UnifiedToolDescriptor[] {
    const label = this.connection.instanceLabel;

    return [
      {
        name: 'playwright.navigate',
        description: `Navigate using the "${label}" browser instance and return the final page title and URL.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.extract_text',
        description: `Read page text from the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
            maxLength: { type: 'number' },
          },
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.screenshot',
        description: `Capture a screenshot with the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
            fullPage: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.click',
        description: `Click an element with the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
          },
          required: ['selector'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: true,
      },
      {
        name: 'playwright.fill',
        description: `Fill an input using the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['selector', 'value'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: true,
      },
      {
        name: 'playwright.submit_form',
        description: `Submit a form using the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
          },
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: true,
      },
      {
        name: 'playwright.login_with_profile',
        description: `Log in using a stored secret profile with the "${label}" browser instance.`,
        parameters: {
          type: 'object',
          properties: {
            profileName: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['profileName'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpConnectionId: this.connection.id,
        integrationKind: 'playwright',
        instanceLabel: label,
        requiresApproval: true,
      },
    ];
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    const context = await createIsolatedContext(this.connection);

    try {
      const page = await context.newPage();
      switch (input.toolName) {
        case 'playwright.navigate':
          await page.goto(asString(input.arguments['url']) ?? 'about:blank', {
            waitUntil: 'domcontentloaded',
          });
          return {
            success: true,
            result: {
              title: await page.title(),
              url: page.url(),
            },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        case 'playwright.extract_text': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          const maxLength = asNumber(input.arguments['maxLength']) ?? 4000;
          const text = selector
            ? await page.locator(selector).innerText()
            : await page.locator('body').innerText();
          return {
            success: true,
            result: {
              title: await page.title(),
              url: page.url(),
              text: text.slice(0, maxLength),
            },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.screenshot': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          const fullPage = asBoolean(input.arguments['fullPage']) ?? !selector;
          const buffer = selector
            ? await page.locator(selector).screenshot()
            : await page.screenshot({ fullPage });
          return {
            success: true,
            result: {
              title: await page.title(),
              url: page.url(),
              mimeType: 'image/png',
              base64: buffer.toString('base64'),
            },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.click': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          if (!selector) {
            return { success: false, result: null, error: 'Missing selector' };
          }
          await page.locator(selector).click();
          return {
            success: true,
            result: { url: page.url(), title: await page.title(), clicked: selector },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.fill': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          const value = asString(input.arguments['value']);
          if (!selector || typeof value === 'undefined') {
            return { success: false, result: null, error: 'Missing selector or value' };
          }
          await page.locator(selector).fill(value);
          return {
            success: true,
            result: { url: page.url(), title: await page.title(), filled: selector },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.submit_form': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          if (selector) {
            await page.locator(selector).evaluate((form) => {
              if (form && typeof (form as { requestSubmit?: () => void }).requestSubmit === 'function') {
                (form as { requestSubmit: () => void }).requestSubmit();
              }
            });
          } else {
            await page.locator('form').first().evaluate((form) => {
              if (form && typeof (form as { requestSubmit?: () => void }).requestSubmit === 'function') {
                (form as { requestSubmit: () => void }).requestSubmit();
              }
            });
          }
          return {
            success: true,
            result: { url: page.url(), title: await page.title(), submitted: selector ?? 'form' },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.login_with_profile': {
          const profileName = asString(input.arguments['profileName']);
          if (!profileName) {
            return { success: false, result: null, error: 'Missing profileName' };
          }

          const profile = getSecretProfiles(this.connection.credentials)[profileName];
          if (!profile) {
            return {
              success: false,
              result: null,
              error: `Unknown secret profile: ${profileName}`,
            };
          }

          const loginUrl = asString(input.arguments['url']) ?? profile.url;
          if (loginUrl) {
            await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
          }

          if (profile.username && profile.usernameSelector) {
            await page.locator(profile.usernameSelector).fill(profile.username);
          }
          if (profile.password && profile.passwordSelector) {
            await page.locator(profile.passwordSelector).fill(profile.password);
          }
          if (profile.submitSelector) {
            await page.locator(profile.submitSelector).click();
          }

          return {
            success: true,
            result: {
              url: page.url(),
              title: await page.title(),
              profileName,
            },
            connectionUpdate: withUpdatedStorageState(
              this.connection,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        default:
          return {
            success: false,
            result: null,
            error: `Unknown Playwright tool: ${input.toolName}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  async startManualAuthSession(authSessionId: string): Promise<ManualAuthSessionStartResult> {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'aaa-playwright-auth-'));
    const context = await chromium.launchPersistentContext(userDataDir, { headless: false });
    const page = context.pages()[0] ?? (await context.newPage());
    const startUrl = asString(this.connection.settings['manualAuthStartUrl']) ?? 'about:blank';
    await page.goto(startUrl).catch(() => undefined);
    this.authSessions.set(authSessionId, { context, userDataDir });

    return {
      metadata: {
        mode: 'manual_browser',
        instructions:
          'A local Chromium window has been opened for this auth session. Sign in there, then return here and click Save session.',
        startUrl,
      },
    };
  }

  async completeManualAuthSession(authSessionId: string): Promise<ManualAuthSessionCompleteResult> {
    const handle = this.authSessions.get(authSessionId);
    if (!handle) {
      throw new Error('Auth session is no longer available in memory');
    }

    this.authSessions.delete(authSessionId);
    try {
      const storageState = (await handle.context.storageState()) as unknown as Record<string, unknown>;
      await handle.context.close();
      await rm(handle.userDataDir, { force: true, recursive: true }).catch(() => undefined);

      return {
        metadata: {
          savedAt: new Date().toISOString(),
        },
        connectionUpdate: withUpdatedStorageState(this.connection, storageState),
      };
    } finally {
      await handle.context.close().catch(() => undefined);
      await rm(handle.userDataDir, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  async cancelAuthSession(authSessionId: string): Promise<void> {
    const handle = this.authSessions.get(authSessionId);
    if (!handle) {
      return;
    }

    this.authSessions.delete(authSessionId);
    await handle.context.close().catch(() => undefined);
    await rm(handle.userDataDir, { force: true, recursive: true }).catch(() => undefined);
  }

  async shutdown(): Promise<void> {
    for (const authSessionId of this.authSessions.keys()) {
      await this.cancelAuthSession(authSessionId);
    }

    this.logger.info(
      {
        event: 'mcp.playwright.shutdown',
        outcome: 'success',
        mcpConnectionId: this.connection.id,
      },
      'Playwright MCP client shut down',
    );
  }
}
