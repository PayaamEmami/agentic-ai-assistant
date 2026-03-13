export interface AppConfig {
  host: string;
  port: number;
  nodeEnv: string;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  jwtSecret: string;
  s3Bucket: string;
  s3Region: string;
  s3Endpoint: string | undefined;
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
    databaseUrl: required('DATABASE_URL'),
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    openaiApiKey: required('OPENAI_API_KEY'),
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
    jwtSecret,
    s3Bucket: process.env.S3_BUCKET ?? 'aaa-uploads',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Endpoint: process.env.S3_ENDPOINT,
  };
}
