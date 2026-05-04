import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOSTNAME: z.string().optional(),
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
  JWT_SECRET: z.string().default('dev-insecure-jwt-secret'),
  INTERNAL_SERVICE_SECRET: z.string().default('dev-internal-service-secret'),
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
  APP_CREDENTIALS_SECRET: z.string().default('dev-app-credentials-secret'),
});

export type Env = z.infer<typeof envSchema>;
export type LogEnv = z.infer<typeof logEnvSchema>;
export type TraceEnv = z.infer<typeof traceEnvSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type OpenAiEnv = z.infer<typeof openAiEnvSchema>;
export type GoogleOAuthEnv = z.infer<typeof googleOAuthEnvSchema>;
export type CredentialsEnv = z.infer<typeof credentialsEnvSchema>;
export type JwtEnv = z.infer<typeof jwtEnvSchema>;
export type InternalServiceEnv = z.infer<typeof internalServiceEnvSchema>;

const logEnvSchema = envSchema.pick({
  NODE_ENV: true,
  HOSTNAME: true,
  LOG_LEVEL: true,
  LOG_FORMAT: true,
  LOG_FILE_ENABLED: true,
  LOG_LOKI_ENDPOINT: true,
});

const traceEnvSchema = envSchema.pick({
  NODE_ENV: true,
  OTEL_EXPORTER_OTLP_ENDPOINT: true,
  OTEL_SERVICE_NAMESPACE: true,
});

const databaseEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  DATABASE_POOL_SIZE: true,
});

const openAiEnvSchema = envSchema.pick({
  OPENAI_API_KEY: true,
  OPENAI_MODEL: true,
  OPENAI_EMBEDDING_MODEL: true,
  OPENAI_PRICING_OVERRIDES_JSON: true,
});

const googleOAuthEnvSchema = envSchema.pick({
  GOOGLE_CLIENT_ID: true,
  GOOGLE_CLIENT_SECRET: true,
});

const credentialsEnvSchema = envSchema.pick({
  APP_CREDENTIALS_SECRET: true,
});

const jwtEnvSchema = envSchema.pick({
  JWT_SECRET: true,
});

const internalServiceEnvSchema = envSchema.pick({
  HOSTNAME: true,
  API_PORT: true,
  INTERNAL_SERVICE_SECRET: true,
  API_INSTANCE_ID: true,
  API_INTERNAL_BASE_URL: true,
  API_BASE_URL: true,
});

let cachedEnv: Env | null = null;
let cachedLogEnv: LogEnv | null = null;
let cachedTraceEnv: TraceEnv | null = null;
let cachedDatabaseEnv: DatabaseEnv | null = null;
let cachedOpenAiEnv: OpenAiEnv | null = null;
let cachedGoogleOAuthEnv: GoogleOAuthEnv | null = null;
let cachedCredentialsEnv: CredentialsEnv | null = null;
let cachedInternalServiceEnv: InternalServiceEnv | null = null;

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
  cachedLogEnv = null;
  cachedTraceEnv = null;
  cachedDatabaseEnv = null;
  cachedOpenAiEnv = null;
  cachedGoogleOAuthEnv = null;
  cachedCredentialsEnv = null;
  cachedInternalServiceEnv = null;
}

function parseSubset<TSchema extends z.ZodTypeAny>(schema: TSchema): z.infer<TSchema> {
  return schema.parse(process.env);
}

export function loadLogEnv(): LogEnv {
  if (cachedLogEnv) return cachedLogEnv;
  cachedLogEnv = parseSubset(logEnvSchema);
  return cachedLogEnv;
}

export function loadTraceEnv(): TraceEnv {
  if (cachedTraceEnv) return cachedTraceEnv;
  cachedTraceEnv = parseSubset(traceEnvSchema);
  return cachedTraceEnv;
}

export function loadDatabaseEnv(): DatabaseEnv {
  if (cachedDatabaseEnv) return cachedDatabaseEnv;
  cachedDatabaseEnv = parseSubset(databaseEnvSchema);
  return cachedDatabaseEnv;
}

export function loadOpenAiEnv(): OpenAiEnv {
  if (cachedOpenAiEnv) return cachedOpenAiEnv;
  cachedOpenAiEnv = parseSubset(openAiEnvSchema);
  return cachedOpenAiEnv;
}

export function loadGoogleOAuthEnv(): GoogleOAuthEnv {
  if (cachedGoogleOAuthEnv) return cachedGoogleOAuthEnv;
  cachedGoogleOAuthEnv = parseSubset(googleOAuthEnvSchema);
  return cachedGoogleOAuthEnv;
}

export function loadCredentialsEnv(): CredentialsEnv {
  if (cachedCredentialsEnv) return cachedCredentialsEnv;
  cachedCredentialsEnv = parseSubset(credentialsEnvSchema);
  return cachedCredentialsEnv;
}

export function loadJwtEnv(): JwtEnv {
  return parseSubset(jwtEnvSchema);
}

export function loadInternalServiceEnv(): InternalServiceEnv {
  if (cachedInternalServiceEnv) return cachedInternalServiceEnv;
  cachedInternalServiceEnv = parseSubset(internalServiceEnvSchema);
  return cachedInternalServiceEnv;
}
