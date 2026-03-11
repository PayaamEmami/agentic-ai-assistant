import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './lib/logger.js';

async function main() {
  const config = loadConfig();
  const server = await buildServer(config);

  try {
    await server.listen({ host: config.host, port: config.port });
    logger.info(`Server listening on ${config.host}:${config.port}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
