import { describe, expect, it } from 'vitest';
import {
  asNonEmptyString,
  asNumber,
  asString,
  isAbortError,
  isRecord,
  requireString,
} from './guards.js';

describe('isRecord', () => {
  it('accepts plain objects and rejects null/primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('asString vs asNonEmptyString', () => {
  it('asString accepts empty strings but rejects non-strings', () => {
    expect(asString('')).toBe('');
    expect(asString('a')).toBe('a');
    expect(asString(1)).toBeUndefined();
  });

  it('asNonEmptyString rejects blank strings', () => {
    expect(asNonEmptyString('  ')).toBeUndefined();
    expect(asNonEmptyString('a')).toBe('a');
  });
});

describe('asNumber', () => {
  it('accepts only finite numbers', () => {
    expect(asNumber(3)).toBe(3);
    expect(asNumber(Number.NaN)).toBeUndefined();
    expect(asNumber('3')).toBeUndefined();
  });
});

describe('requireString', () => {
  it('returns non-empty values and throws otherwise', () => {
    expect(requireString({ key: 'value' }, 'key')).toBe('value');
    expect(() => requireString({ key: '  ' }, 'key')).toThrow(/non-empty string/);
    expect(() => requireString({}, 'missing')).toThrow(/missing/);
  });
});

describe('isAbortError', () => {
  it('recognizes abort-style errors from supported providers', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(Object.assign(new Error('stop'), { name: 'APIUserAbortError' }))).toBe(true);
    expect(isAbortError(new Error('Chat run interrupted'))).toBe(true);
    expect(isAbortError(new Error('other'))).toBe(false);
    expect(isAbortError('nope')).toBe(false);
  });
});
