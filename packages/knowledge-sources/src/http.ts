import { createHttpClient } from '@aaa/observability';

export const { requestJson, requestText } = createHttpClient({
  component: 'knowledge-source-http',
  eventPrefix: 'knowledge_source.http',
});
