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
  connectorCredentialsSecret: string;
  otlpEndpoint?: string;
  otelServiceNamespace?: string;
  otelResourceAttributes?: string;
  logFileEnabled?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  googleRedirectUriBase?: string;
  googleDriveActionsRedirectUri?: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubRedirectUri?: string;
  githubRedirectUriBase?: string;
  githubActionsRedirectUri?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
  };

  const jwtSecret =
    process.env.JWT_SECRET ??
    (nodeEnv === 'production' ? required('JWT_SECRET') : 'dev-insecure-jwt-secret');

  return {
    host: process.env.API_HOST ?? '0.0.0.0',
    port: parseInt(process.env.API_PORT ?? '3001', 10),
    nodeEnv,
    logLevel: process.env.LOG_LEVEL ?? 'info',
    logFormat:
      process.env.LOG_FORMAT === 'json'
        ? 'json'
        : process.env.LOG_FORMAT === 'pretty'
          ? 'pretty'
          : nodeEnv === 'development'
            ? 'pretty'
            : 'json',
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    openaiApiKey: required('OPENAI_API_KEY'),
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    openaiRealtimeModel: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime-1.5',
    openaiRealtimeVoice: process.env.OPENAI_REALTIME_VOICE ?? 'marin',
    jwtSecret,
    s3Bucket: process.env.S3_BUCKET ?? 'aaa-uploads',
    s3Region: process.env.S3_REGION ?? 'us-west-1',
    s3Endpoint: process.env.S3_ENDPOINT,
    webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    connectorCredentialsSecret:
      process.env.CONNECTOR_CREDENTIALS_SECRET ??
      (nodeEnv === 'production'
        ? required('CONNECTOR_CREDENTIALS_SECRET')
        : 'dev-connector-credentials-secret'),
    otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    otelServiceNamespace: process.env.OTEL_SERVICE_NAMESPACE,
    otelResourceAttributes: process.env.OTEL_RESOURCE_ATTRIBUTES,
    logFileEnabled:
      typeof process.env.LOG_FILE_ENABLED === 'string'
        ? process.env.LOG_FILE_ENABLED === '1' || process.env.LOG_FILE_ENABLED === 'true'
        : undefined,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    googleRedirectUriBase: process.env.GOOGLE_REDIRECT_URI_BASE,
    googleDriveActionsRedirectUri: process.env.GOOGLE_DRIVE_ACTIONS_REDIRECT_URI,
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
    githubRedirectUri: process.env.GITHUB_REDIRECT_URI,
    githubRedirectUriBase: process.env.GITHUB_REDIRECT_URI_BASE,
    githubActionsRedirectUri: process.env.GITHUB_ACTIONS_REDIRECT_URI,
  };
}
