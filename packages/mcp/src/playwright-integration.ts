import { chromium, type BrowserContext, type Page } from 'playwright';
import { getLogger } from '@aaa/observability';
import type {
  RuntimeMcpProfile,
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

async function createIsolatedContext(profile: RuntimeMcpProfile): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });
  const storageState = getStorageState(profile.credentials);
  const context = await browser.newContext(storageState ? { storageState: storageState as never } : undefined);
  context.on('close', async () => {
    await browser.close().catch(() => undefined);
  });
  return context;
}

function withUpdatedStorageState(
  profile: RuntimeMcpProfile,
  storageState: Record<string, unknown>,
): ToolExecutionOutput['profileUpdate'] {
  return {
    credentials: {
      ...profile.credentials,
      storageState,
    },
  };
}

export class PlaywrightProfileClient {
  private profile: RuntimeMcpProfile;
  private readonly logger = getLogger({ component: 'mcp-playwright' });

  constructor(profile: RuntimeMcpProfile) {
    this.profile = profile;
  }

  updateProfile(profile: RuntimeMcpProfile): void {
    this.profile = profile;
  }

  listTools(): UnifiedToolDescriptor[] {
    const label = this.profile.profileLabel;

    return [
      {
        name: 'playwright.navigate',
        description: `Navigate using the "${label}" browser profile and return the final page title and URL.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
          },
          required: ['url'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.extract_text',
        description: `Read page text from the "${label}" browser profile.`,
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
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.screenshot',
        description: `Capture a screenshot with the "${label}" browser profile.`,
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
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.click',
        description: `Click an element with the "${label}" browser profile for ordinary browsing and link navigation.`,
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
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.fill',
        description: `Fill an input using the "${label}" browser profile.`,
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
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: true,
      },
      {
        name: 'playwright.submit_form',
        description: `Submit a form with the "${label}" browser profile for ordinary browsing, search, and navigation flows.`,
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            selector: { type: 'string' },
          },
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
      {
        name: 'playwright.login_with_profile',
        description: `Log in using a stored secret profile with the "${label}" browser profile.`,
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
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: true,
      },
      {
        name: 'playwright.start_handoff',
        description:
          `Start an interactive browser handoff using the "${label}" browser profile when a human must complete sign-in, CAPTCHA, MFA, consent, or another manual browser step.`,
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['reason'],
          additionalProperties: false,
        },
        origin: 'mcp',
        mcpProfileId: this.profile.id,
        integrationKind: 'playwright',
        profileLabel: label,
        requiresApproval: false,
      },
    ];
  }

  async executeTool(input: ToolExecutionInput): Promise<ToolExecutionOutput> {
    if (input.toolName === 'playwright.start_handoff') {
      return {
        success: false,
        result: null,
        error: 'playwright.start_handoff must be handled by the API handoff flow',
      };
    }

    const context = await createIsolatedContext(this.profile);

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
            profileUpdate: withUpdatedStorageState(
              this.profile,
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
            profileUpdate: withUpdatedStorageState(
              this.profile,
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
            profileUpdate: withUpdatedStorageState(
              this.profile,
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
            profileUpdate: withUpdatedStorageState(
              this.profile,
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
            profileUpdate: withUpdatedStorageState(
              this.profile,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.submit_form': {
          await gotoIfProvided(page, input.arguments);
          const selector = asString(input.arguments['selector']);
          if (selector) {
            await page.locator(selector).evaluate((form) => {
              if (
                form &&
                typeof (form as { requestSubmit?: () => void }).requestSubmit === 'function'
              ) {
                (form as { requestSubmit: () => void }).requestSubmit();
              }
            });
          } else {
            await page.locator('form').first().evaluate((form) => {
              if (
                form &&
                typeof (form as { requestSubmit?: () => void }).requestSubmit === 'function'
              ) {
                (form as { requestSubmit: () => void }).requestSubmit();
              }
            });
          }
          return {
            success: true,
            result: { url: page.url(), title: await page.title(), submitted: selector ?? 'form' },
            profileUpdate: withUpdatedStorageState(
              this.profile,
              (await context.storageState()) as unknown as Record<string, unknown>,
            ),
          };
        }
        case 'playwright.login_with_profile': {
          const profileName = asString(input.arguments['profileName']);
          if (!profileName) {
            return { success: false, result: null, error: 'Missing profileName' };
          }

          const secretProfile = getSecretProfiles(this.profile.credentials)[profileName];
          if (!secretProfile) {
            return {
              success: false,
              result: null,
              error: `Unknown secret profile: ${profileName}`,
            };
          }

          const loginUrl = asString(input.arguments['url']) ?? secretProfile.url;
          if (loginUrl) {
            await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
          }

          if (secretProfile.username && secretProfile.usernameSelector) {
            await page.locator(secretProfile.usernameSelector).fill(secretProfile.username);
          }
          if (secretProfile.password && secretProfile.passwordSelector) {
            await page.locator(secretProfile.passwordSelector).fill(secretProfile.password);
          }
          if (secretProfile.submitSelector) {
            await page.locator(secretProfile.submitSelector).click();
          }

          return {
            success: true,
            result: {
              url: page.url(),
              title: await page.title(),
              profileName,
            },
            profileUpdate: withUpdatedStorageState(
              this.profile,
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

  async shutdown(): Promise<void> {
    this.logger.info(
      {
        event: 'mcp.playwright.shutdown',
        outcome: 'success',
        mcpProfileId: this.profile.id,
      },
      'Playwright MCP profile client shut down',
    );
  }
}
