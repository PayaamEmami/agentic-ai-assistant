import { z } from 'zod';

export const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
