import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConflictError,
  GhDbError,
  KeyValidationError,
  NetworkError,
  NotFoundError,
  ParseError,
  PermissionError,
  RateLimitError,
  RetryExhaustedError,
  RollbackError,
  SerializationError,
  ServerError,
  StagingError,
  ValidationError,
} from '../../../src/errors/index.js';

describe('errors hierarchy', () => {
  it('every subclass extends GhDbError and Error', () => {
    const subclasses: GhDbError[] = [
      new AuthError('a'),
      new PermissionError('a'),
      new NotFoundError('a', { resourceKind: 'repo' }),
      new ValidationError('a'),
      new ConflictError('a', { baselineSha: 'b', remoteSha: 'r' }),
      new RateLimitError('a', { kind: 'primary' }),
      new ServerError('a', { status: 500 }),
      new NetworkError('a'),
      new ParseError('a', { key: 'k', contentSizeBytes: 0 }),
      new SerializationError('a', { key: 'k', reason: 'circular' }),
      new KeyValidationError('a', { key: 'k' }),
      new RetryExhaustedError('a', { underlying: 'network', attempts: 3 }),
      new StagingError('a', { key: 'k', violation: 'create_on_existing' }),
      new RollbackError('a', { reason: 'initial_commit' }),
    ];
    for (const err of subclasses) {
      expect(err).toBeInstanceOf(GhDbError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.code).toBe('string');
    }
  });

  it('AuthError carries code "auth"', () => {
    expect(new AuthError('x').code).toBe('auth');
  });

  it('PermissionError carries code "permission" and optional requiredScope', () => {
    const e = new PermissionError('x', { requiredScope: 'repo' });
    expect(e.code).toBe('permission');
    expect(e.requiredScope).toBe('repo');
  });

  it('NotFoundError carries resourceKind', () => {
    const e = new NotFoundError('x', { resourceKind: 'hook' });
    expect(e.code).toBe('not_found');
    expect(e.resourceKind).toBe('hook');
  });

  it('ValidationError carries optional subcode', () => {
    const e = new ValidationError('x', { subcode: 'already_exists' });
    expect(e.code).toBe('validation');
    expect(e.subcode).toBe('already_exists');
  });

  it('ConflictError carries baseline/remote/overlapping', () => {
    const e = new ConflictError('x', {
      baselineSha: 'b1',
      remoteSha: 'r1',
      overlappingKeys: ['k1'],
    });
    expect(e.code).toBe('conflict');
    expect(e.baselineSha).toBe('b1');
    expect(e.remoteSha).toBe('r1');
    expect(e.overlappingKeys).toEqual(['k1']);
  });

  it('RateLimitError carries kind and resetAt', () => {
    const t = new Date(123);
    const e = new RateLimitError('x', { kind: 'secondary', resetAt: t });
    expect(e.code).toBe('rate_limit');
    expect(e.kind).toBe('secondary');
    expect(e.resetAt).toBe(t);
  });

  it('ServerError carries status', () => {
    expect(new ServerError('x', { status: 503 }).status).toBe(503);
  });

  it('NetworkError carries cause', () => {
    const cause = new Error('boom');
    expect(new NetworkError('x', { cause }).cause).toBe(cause);
  });

  it('ParseError carries key and contentSizeBytes', () => {
    const e = new ParseError('x', { key: 'k', contentSizeBytes: 42 });
    expect(e.key).toBe('k');
    expect(e.contentSizeBytes).toBe(42);
  });

  it('SerializationError carries reason', () => {
    const e = new SerializationError('x', { key: 'k', reason: 'circular' });
    expect(e.reason).toBe('circular');
  });

  it('KeyValidationError carries key', () => {
    expect(new KeyValidationError('x', { key: 'bad/key' }).key).toBe('bad/key');
  });

  it('RetryExhaustedError carries underlying + attempts + resetAt', () => {
    const t = new Date(456);
    const e = new RetryExhaustedError('x', {
      underlying: 'rate_limit',
      attempts: 5,
      resetAt: t,
    });
    expect(e.underlying).toBe('rate_limit');
    expect(e.attempts).toBe(5);
    expect(e.resetAt).toBe(t);
  });

  it('StagingError carries key and violation', () => {
    const e = new StagingError('x', { key: 'k', violation: 'update_on_missing' });
    expect(e.violation).toBe('update_on_missing');
  });

  it('RollbackError carries reason', () => {
    expect(new RollbackError('x', { reason: 'staging_not_empty' }).reason).toBe(
      'staging_not_empty',
    );
  });

  it('preserves Error name as the subclass class name', () => {
    expect(new AuthError('x').name).toBe('AuthError');
    expect(new ConflictError('x', { baselineSha: 'b', remoteSha: 'r' }).name).toBe(
      'ConflictError',
    );
  });
});
