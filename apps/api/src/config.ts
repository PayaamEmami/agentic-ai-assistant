import { loadEnv } from '@aaa/config';

export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: string;
  logLevel: string;
  logFormat: 'pretty' | 'json';
  databaseUrl: string;
  redisUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiEmbeddingModel: string;
  openaiRealtimeModel: string;
  openaiRealtimeVoice: string;
  jwtSecret: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string | undefined;
  webBaseUrl: string;
  appCredentialsSecret: string;
  otlpEndpoint?: string;
  otelServiceNamespace?: string;
  otelResourceAttributes?: string;
  logFileEnabled?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleAppRedirectUriBase?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubAppRedirectUriBase?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function loadConfig(): AppConfig {
  const env = loadEnv();
  const nodeEnv = env.NODE_ENV;
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  const jwtSecret =
    env.JWT_SECRET ??
    (nodeEnv === 'production' ? required('JWT_SECRET') : 'dev-insecure-jwt-secret');

  return {
    host: env.API_HOST,
    port: env.API_PORT,
    nodeEnv,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    openaiRealtimeModel: env.OPENAI_REALTIME_MODEL,
    openaiRealtimeVoice: env.OPENAI_REALTIME_VOICE,
    jwtSecret,
    s3Bucket: env.S3_BUCKET,
    s3Region: env.S3_REGION,
    s3Endpoint: env.S3_ENDPOINT,
    webBaseUrl: env.WEB_BASE_URL,
    appCredentialsSecret:
      env.APP_CREDENTIALS_SECRET ??
      (nodeEnv === 'production'
        ? required('APP_CREDENTIALS_SECRET')
        : 'dev-app-credentials-secret'),
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceNamespace: env.OTEL_SERVICE_NAMESPACE,
    otelResourceAttributes: env.OTEL_RESOURCE_ATTRIBUTES,
    logFileEnabled:
      typeof env.LOG_FILE_ENABLED === 'string'
        ? env.LOG_FILE_ENABLED === '1' || env.LOG_FILE_ENABLED === 'true'
        : undefined,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    googleAppRedirectUriBase: env.GOOGLE_APP_REDIRECT_URI_BASE,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubAppRedirectUriBase: env.GITHUB_APP_REDIRECT_URI_BASE,
  };
}
