import { createServiceLogger } from '@aaa/observability';

export const logger = createServiceLogger({
  service: 'worker',
  setAsDefault: true,
});
