import { describe, expect, it } from 'vitest';
import * as ghdb from '../../src/index.js';

const EXPECTED_VALUE_EXPORTS = [
  'GhDb',
  'GhDbError',
  'AuthError',
  'PermissionError',
  'NotFoundError',
  'ValidationError',
  'ConflictError',
  'RateLimitError',
  'ServerError',
  'NetworkError',
  'ParseError',
  'SerializationError',
  'KeyValidationError',
  'RetryExhaustedError',
  'StagingError',
  'RollbackError',
];

describe('public API shape', () => {
  it('exports exactly the documented value symbols', () => {
    const actual = Object.keys(ghdb).filter(
      (k) => typeof (ghdb as Record<string, unknown>)[k] !== 'undefined',
    );
    const sortedActual = [...actual].sort();
    const sortedExpected = [...EXPECTED_VALUE_EXPORTS].sort();
    expect(sortedActual).toEqual(sortedExpected);
  });

  it('GhDb is a constructor', () => {
    expect(typeof ghdb.GhDb).toBe('function');
  });

  it('every error class extends GhDbError', () => {
    const subclasses = [
      ghdb.AuthError,
      ghdb.PermissionError,
      ghdb.NotFoundError,
      ghdb.ValidationError,
      ghdb.ConflictError,
      ghdb.RateLimitError,
      ghdb.ServerError,
      ghdb.NetworkError,
      ghdb.ParseError,
      ghdb.SerializationError,
      ghdb.KeyValidationError,
      ghdb.RetryExhaustedError,
      ghdb.StagingError,
      ghdb.RollbackError,
    ];
    for (const C of subclasses) {
      expect(C.prototype).toBeInstanceOf(ghdb.GhDbError);
    }
  });
});
