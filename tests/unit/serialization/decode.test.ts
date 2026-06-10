import { describe, expect, it } from 'vitest';
import { ParseError } from '../../../src/errors/index.js';
import { decodeJson } from '../../../src/serialization/decode.js';

describe('decodeJson', () => {
  it('parses a JSON object', () => {
    expect(decodeJson('k', '{"a": 1}')).toEqual({ a: 1 });
  });

  it('parses primitives, arrays, nulls', () => {
    expect(decodeJson('k', '42')).toBe(42);
    expect(decodeJson('k', '"hi"')).toBe('hi');
    expect(decodeJson('k', 'null')).toBeNull();
    expect(decodeJson('k', '[1,2]')).toEqual([1, 2]);
  });

  it('throws ParseError with key and contentSizeBytes on malformed JSON', () => {
    const malformed = '{not json';
    try {
      decodeJson('alice', malformed);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).key).toBe('alice');
      expect((err as ParseError).contentSizeBytes).toBe(Buffer.byteLength(malformed, 'utf8'));
    }
  });

  it('does not include the raw content in the error message', () => {
    const sensitive = '{"secret": "abc12';
    try {
      decodeJson('k', sensitive);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as ParseError).message).not.toContain('abc12');
    }
  });
});
