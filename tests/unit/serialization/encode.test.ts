import { describe, expect, it } from 'vitest';
import { SerializationError } from '../../../src/errors/index.js';
import { encodeJson } from '../../../src/serialization/encode.js';

describe('encodeJson', () => {
  it('encodes simple objects with 2-space indent', () => {
    const out = encodeJson('alice', { name: 'Alice' });
    expect(out).toBe('{\n  "name": "Alice"\n}');
  });

  it('encodes arrays', () => {
    expect(encodeJson('xs', [1, 2, 3])).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('encodes primitives', () => {
    expect(encodeJson('s', 'hello')).toBe('"hello"');
    expect(encodeJson('n', 42)).toBe('42');
    expect(encodeJson('b', true)).toBe('true');
    expect(encodeJson('null', null)).toBe('null');
  });

  it('rejects circular references with reason "circular"', () => {
    const obj: Record<string, unknown> = {};
    obj['self'] = obj;
    try {
      encodeJson('k', obj as never);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SerializationError);
      expect((err as SerializationError).reason).toBe('circular');
      expect((err as SerializationError).key).toBe('k');
    }
  });

  it('rejects BigInt with reason "unsupported_type"', () => {
    try {
      encodeJson('k', { n: BigInt(1) } as never);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SerializationError);
      expect((err as SerializationError).reason).toBe('unsupported_type');
    }
  });

  it('rejects undefined top-level value', () => {
    try {
      encodeJson('k', undefined as never);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SerializationError);
      expect((err as SerializationError).reason).toBe('undefined_top_level');
    }
  });

  it('rejects function top-level value', () => {
    try {
      encodeJson('k', (() => 1) as never);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SerializationError);
      expect((err as SerializationError).reason).toBe('undefined_top_level');
    }
  });
});
