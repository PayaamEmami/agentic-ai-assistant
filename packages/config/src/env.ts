import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  LOG_FILE_ENABLED: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
  LOG_LOKI_ENDPOINT: z.string().optional(),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string(),
  DATABASE_POOL_SIZE: z.coerce.number().default(10),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAMESPACE: z.string().optional(),
  OTEL_RESOURCE_ATTRIBUTES: z.string().optional(),
  WORKER_OBSERVABILITY_HOST: z.string().default('0.0.0.0'),
  WORKER_OBSERVABILITY_PORT: z.coerce.number().default(9464),
  OPENAI_PRICING_OVERRIDES_JSON: z.string().optional(),

  S3_BUCKET: z.string().default('aaa-uploads'),
  S3_REGION: z.string().default('us-west-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-1.5'),
  OPENAI_REALTIME_VOICE: z.string().default('marin'),
  JWT_SECRET: z.string().optional(),
  INTERNAL_SERVICE_SECRET: z.string().optional(),
  API_INSTANCE_ID: z.string().optional(),
  API_INTERNAL_BASE_URL: z.string().optional(),
  INTERNAL_API_BASE_URL: z.string().optional(),
  API_BASE_URL: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_APP_REDIRECT_URI_BASE: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_APP_REDIRECT_URI_BASE: z.string().optional(),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  APP_CREDENTIALS_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const missing = Object.entries(formatted)
      .map(([key, errs]) => `  ${key}: ${errs?.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
