import { describe, expect, it } from 'vitest';
import { serializeError } from './sanitize.js';

describe('serializeError', () => {
  it('redacts a bearer token from the stack as well as the message', () => {
    const error = new Error('request failed: Bearer sk-secret.token');
    const serialized = serializeError(error);

    expect(serialized.message).toBe('request failed: Bearer [Redacted]');
    expect(serialized.stack).toContain('Bearer [Redacted]');
    expect(serialized.stack).not.toContain('sk-secret');
  });

  it('redacts a connection string embedded in the message and the stack', () => {
    const error = new Error('connect postgres://user:secret@localhost:5432/db failed');
    const serialized = serializeError(error);

    expect(serialized.message).toBe('connect [Redacted Connection String]');
    expect(serialized.stack).not.toContain('secret');
    expect(serialized.stack).toContain('[Redacted Connection String]');
  });
});
