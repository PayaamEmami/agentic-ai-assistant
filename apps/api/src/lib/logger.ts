import { createServiceLogger } from '@aaa/observability';

export const logger = createServiceLogger({
  service: 'api',
  setAsDefault: true,
});
