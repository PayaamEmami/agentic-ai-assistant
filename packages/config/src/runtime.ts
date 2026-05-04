import { randomUUID } from 'node:crypto';
import type { Env, InternalServiceEnv } from './env.js';
import { loadEnv } from './env.js';

export interface RedisConnectionConfig {
  host: string;
  port: number;
  password?: string;
}

export interface ApiConfig {
  host: string;
  port: number;
  nodeEnv: Env['NODE_ENV'];
  logLevel: Env['LOG_LEVEL'];
  logFormat: Env['LOG_FORMAT'];
  databaseUrl: string;
  databasePoolSize: number;
  redisUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  openaiRealtimeModel: string;
  openaiRealtimeVoice: string;
  jwtSecret: string;
  internalServiceSecret: string;
  apiInstanceId: string;
  apiInternalBaseUrl: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string | undefined;
  s3AccessKeyId: string | undefined;
  s3SecretAccessKey: string | undefined;
  webBaseUrl: string;
  appCredentialsSecret: string;
  otlpEndpoint?: string;
  otelServiceNamespace?: string;
  otelResourceAttributes?: string;
  logFileEnabled?: boolean;
  logLokiEndpoint?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleAppRedirectUriBase?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubAppRedirectUriBase?: string;
}

export interface WorkerConfig {
  nodeEnv: Env['NODE_ENV'];
  logLevel: Env['LOG_LEVEL'];
  logFormat: Env['LOG_FORMAT'];
  redisUrl: string;
  databaseUrl: string;
  databasePoolSize: number;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  internalServiceSecret: string;
  apiInternalBaseUrl: string;
  workerObservabilityHost: string;
  workerObservabilityPort: number;
  logFileEnabled?: boolean;
  logLokiEndpoint?: string;
  otlpEndpoint?: string;
  otelServiceNamespace?: string;
  otelResourceAttributes?: string;
}

export function parseOptionalBooleanFlag(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }
  return undefined;
}

export function parseRedisUrl(url: string): RedisConnectionConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

export function buildApiInternalBaseUrl(env: Pick<Env, 'API_INTERNAL_BASE_URL' | 'API_BASE_URL' | 'API_PORT'>): string {
  return env.API_INTERNAL_BASE_URL ?? env.API_BASE_URL ?? `http://127.0.0.1:${env.API_PORT}`;
}

export function buildApiInstanceId(env: Pick<InternalServiceEnv, 'API_INSTANCE_ID' | 'HOSTNAME'>): string {
  return env.API_INSTANCE_ID ?? env.HOSTNAME ?? randomUUID();
}

export function loadApiConfig(): ApiConfig {
  const env = loadEnv();
  return {
    host: env.API_HOST,
    port: env.API_PORT,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    databaseUrl: env.DATABASE_URL,
    databasePoolSize: env.DATABASE_POOL_SIZE,
    redisUrl: env.REDIS_URL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    openaiRealtimeModel: env.OPENAI_REALTIME_MODEL,
    openaiRealtimeVoice: env.OPENAI_REALTIME_VOICE,
    jwtSecret: env.JWT_SECRET,
    internalServiceSecret: env.INTERNAL_SERVICE_SECRET,
    apiInstanceId: buildApiInstanceId(env),
    apiInternalBaseUrl: buildApiInternalBaseUrl(env),
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION,
    s3Endpoint: env.S3_ENDPOINT,
    s3AccessKeyId: env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY,
    webBaseUrl: env.WEB_BASE_URL,
    appCredentialsSecret: env.APP_CREDENTIALS_SECRET,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceNamespace: env.OTEL_SERVICE_NAMESPACE,
    otelResourceAttributes: env.OTEL_RESOURCE_ATTRIBUTES,
    logFileEnabled: parseOptionalBooleanFlag(env.LOG_FILE_ENABLED),
    logLokiEndpoint: env.LOG_LOKI_ENDPOINT,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleAppRedirectUriBase: env.GOOGLE_APP_REDIRECT_URI_BASE,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubAppRedirectUriBase: env.GITHUB_APP_REDIRECT_URI_BASE,
  };
}

export function loadWorkerConfig(): WorkerConfig {
  const env = loadEnv();
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    redisUrl: env.REDIS_URL,
    databaseUrl: env.DATABASE_URL,
    databasePoolSize: env.DATABASE_POOL_SIZE,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    internalServiceSecret: env.INTERNAL_SERVICE_SECRET,
    apiInternalBaseUrl: buildApiInternalBaseUrl(env),
    workerObservabilityHost: env.WORKER_OBSERVABILITY_HOST,
    workerObservabilityPort: env.WORKER_OBSERVABILITY_PORT,
    logFileEnabled: parseOptionalBooleanFlag(env.LOG_FILE_ENABLED),
    logLokiEndpoint: env.LOG_LOKI_ENDPOINT,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceNamespace: env.OTEL_SERVICE_NAMESPACE,
    otelResourceAttributes: env.OTEL_RESOURCE_ATTRIBUTES,
  };
}
