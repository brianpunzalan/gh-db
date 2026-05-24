import { describe, expect, it } from 'vitest';
import { resolveConflictPolicy } from '../../../src/conflict/policy.js';
import { GhDbError } from '../../../src/errors/index.js';

describe('resolveConflictPolicy', () => {
  it('returns instance default when per-commit override is undefined', () => {
    expect(resolveConflictPolicy('retry', undefined)).toBe('retry');
    expect(resolveConflictPolicy('fail', undefined)).toBe('fail');
    expect(resolveConflictPolicy('rebase', undefined)).toBe('rebase');
  });

  it('per-commit override beats instance default', () => {
    expect(resolveConflictPolicy('fail', 'rebase')).toBe('rebase');
    expect(resolveConflictPolicy('rebase', 'retry')).toBe('retry');
  });

  it('rejects invalid override value', () => {
    expect(() => resolveConflictPolicy('fail', 'whatever' as never)).toThrow(GhDbError);
  });

  it('accepts all three valid literal values as overrides', () => {
    expect(resolveConflictPolicy('fail', 'fail')).toBe('fail');
    expect(resolveConflictPolicy('fail', 'retry')).toBe('retry');
    expect(resolveConflictPolicy('fail', 'rebase')).toBe('rebase');
  });
});
