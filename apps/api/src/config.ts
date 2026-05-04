import { loadApiConfig, type ApiConfig } from '@aaa/config';

export type AppConfig = ApiConfig;

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

export function loadConfig(): AppConfig {
  return loadApiConfig();
}
