import { describe, expect, it } from 'vitest';
import { GhDbError } from '../../../src/errors/index.js';
import { parseInstanceConfig } from '../../../src/core/instance-config.js';

const base = { owner: 'o', repo: 'r', auth: 't' };

describe('parseInstanceConfig', () => {
  it('returns defaults for all optional fields', () => {
    const c = parseInstanceConfig(base);
    expect(c.baseUrl).toBe('https://api.github.com');
    expect(c.conflictPolicy).toBe('fail');
    expect(c.conflictMaxAttempts).toBe(3);
    expect(c.readConsistency).toBe('fresh');
    expect(c.retryMaxAttempts).toBe(3);
    expect(c.retryBaseDelayMs).toBe(500);
    expect(c.userAgent).toMatch(/^gh-db\//);
  });

  it('rejects empty owner', () => {
    expect(() => parseInstanceConfig({ ...base, owner: '' })).toThrow(GhDbError);
  });

  it('rejects empty repo', () => {
    expect(() => parseInstanceConfig({ ...base, repo: '' })).toThrow(GhDbError);
  });

  it('rejects empty auth', () => {
    expect(() => parseInstanceConfig({ ...base, auth: '' })).toThrow(GhDbError);
  });

  it('clamps conflictMaxAttempts to [1, 10]', () => {
    expect(parseInstanceConfig({ ...base, conflictMaxAttempts: 100 }).conflictMaxAttempts).toBe(10);
    expect(parseInstanceConfig({ ...base, conflictMaxAttempts: 0 }).conflictMaxAttempts).toBe(1);
  });

  it('clamps retryMaxAttempts to [1, 10]', () => {
    expect(parseInstanceConfig({ ...base, retryMaxAttempts: 50 }).retryMaxAttempts).toBe(10);
    expect(parseInstanceConfig({ ...base, retryMaxAttempts: -1 }).retryMaxAttempts).toBe(1);
  });

  it('clamps retryBaseDelayMs to [1, 5000]', () => {
    expect(parseInstanceConfig({ ...base, retryBaseDelayMs: 99_999 }).retryBaseDelayMs).toBe(5000);
    expect(parseInstanceConfig({ ...base, retryBaseDelayMs: 0 }).retryBaseDelayMs).toBe(1);
  });

  it('rejects invalid conflictPolicy', () => {
    expect(() => parseInstanceConfig({ ...base, conflictPolicy: 'foo' as never })).toThrow(
      GhDbError,
    );
  });

  it('rejects invalid readConsistency', () => {
    expect(() => parseInstanceConfig({ ...base, readConsistency: 'eventual' as never })).toThrow(
      GhDbError,
    );
  });

  it('rejects malformed baseUrl', () => {
    expect(() => parseInstanceConfig({ ...base, baseUrl: 'not a url' })).toThrow(GhDbError);
  });

  it('accepts a custom baseUrl', () => {
    const c = parseInstanceConfig({
      ...base,
      baseUrl: 'https://github.enterprise.example.com/api/v3',
    });
    expect(c.baseUrl).toBe('https://github.enterprise.example.com/api/v3');
  });

  it('uses caller-supplied userAgent when provided', () => {
    expect(parseInstanceConfig({ ...base, userAgent: 'my-app/2.0' }).userAgent).toBe('my-app/2.0');
  });

  it('returns an immutable (frozen) config', () => {
    const c = parseInstanceConfig(base);
    expect(Object.isFrozen(c)).toBe(true);
  });
});
