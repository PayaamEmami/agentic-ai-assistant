import { createHttpClient } from '@aaa/observability';

export const { requestJson, requestText } = createHttpClient({
  component: 'native-tool-http',
  eventPrefix: 'native_tool.http',
});
