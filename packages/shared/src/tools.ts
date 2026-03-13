export interface NativeToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
}

export const NATIVE_TOOL_DEFINITIONS: NativeToolDefinition[] = [
  {
    name: 'time.now',
    description: 'Get the current server time in ISO-8601 format.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'sum',
    description: 'Calculate the sum of a list of numbers.',
    parameters: {
      type: 'object',
      properties: {
        numbers: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
        },
      },
      required: ['numbers'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'echo',
    description: 'Echo back the provided text payload.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    requiresApproval: false,
  },
  {
    name: 'external.action',
    description:
      'Execute an external side-effectful action (send, post, modify, delete). Use only when the user asks for an external action.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['action'],
      additionalProperties: true,
    },
    requiresApproval: true,
  },
];
