import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { buildServer } from './server.js';
import type { AppConfig } from './config.js';
import type { ApiServices } from './services/container.js';

type TestServer = Awaited<ReturnType<typeof buildServer>>;

vi.mock('./middleware/auth.js', () => ({
  authenticate: async (request: FastifyRequest): Promise<void> => {
    request.user = {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'test@example.com',
      displayName: 'Test User',
    };
  },
  authenticateToken: vi.fn(),
  extractBearerToken: (authHeader: string | undefined): string | null =>
    authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null,
}));

function testConfig(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    nodeEnv: 'test',
    logLevel: 'silent',
    logFormat: 'json',
    databaseUrl: 'postgres://localhost/test',
    redisUrl: 'redis://localhost:6379',
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-test',
    openaiEmbeddingModel: 'embedding-test',
    openaiRealtimeModel: 'realtime-test',
    openaiRealtimeVoice: 'alloy',
    jwtSecret: 'test-secret',
    s3Bucket: 'test-bucket',
    s3Region: 'us-east-1',
    s3Endpoint: undefined,
    webBaseUrl: 'http://localhost:3000',
    appCredentialsSecret: 'app-secret',
  };
}

function testServices(overrides: Partial<ApiServices> = {}): ApiServices {
  return {
    approvalService: {
      listPending: vi.fn().mockResolvedValue([]),
      decide: vi.fn().mockResolvedValue(undefined),
    },
    appService: {},
    chatService: {
      continueAfterToolExecution: vi.fn().mockResolvedValue({ continued: true }),
      sendMessage: vi.fn().mockResolvedValue({
        conversationId: '22222222-2222-4222-8222-222222222222',
        messageId: '33333333-3333-4333-8333-333333333333',
      }),
      interruptRun: vi.fn().mockResolvedValue({ ok: true, status: 'interrupting' }),
      listConversations: vi.fn().mockResolvedValue([]),
      getConversation: vi.fn(),
      updateConversationTitle: vi.fn(),
      deleteConversation: vi.fn().mockResolvedValue({ ok: true }),
    },
    personalizationService: {},
    uploadService: {},
    voiceService: {
      createSession: vi.fn(),
      answerSession: vi.fn(),
      startTurn: vi.fn(),
      updateAssistantText: vi.fn(),
      prepareTurn: vi.fn(),
      completeTurn: vi.fn(),
      saveTurn: vi.fn(),
      executeToolCall: vi.fn(),
      interruptSession: vi.fn(),
    },
    ...overrides,
  } as unknown as ApiServices;
}

async function createTestServer(services = testServices()): Promise<TestServer> {
  const app = await buildServer(testConfig(), services);
  await app.ready();
  return app;
}

describe('buildServer', () => {
  const apps: TestServer[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.clearAllMocks();
  });

  it('serves health checks without external dependencies', async () => {
    const app = await createTestServer();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', version: '0.0.1' });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.headers['x-correlation-id']).toEqual(response.headers['x-request-id']);
  });

  it('preserves request and correlation headers', async () => {
    const app = await createTestServer();
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: {
        'x-request-id': 'request-123',
        'x-correlation-id': 'correlation-456',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('request-123');
    expect(response.headers['x-correlation-id']).toBe('correlation-456');
  });

  it('uses injected services for internal chat continuations', async () => {
    const services = testServices();
    const app = await createTestServer(services);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/internal/tool-executions/tool-execution-1/continue',
      headers: { 'x-internal-service-secret': 'dev-internal-service-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ continued: true });
    expect(services.chatService.continueAfterToolExecution).toHaveBeenCalledWith(
      'tool-execution-1',
    );
  });

  it('returns validation errors before calling chat services', async () => {
    const services = testServices();
    const app = await createTestServer(services);
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { content: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(services.chatService.sendMessage).not.toHaveBeenCalled();
  });
});
