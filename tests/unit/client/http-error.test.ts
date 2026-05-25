import { describe, expect, it } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  AuthError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../../../src/errors/index.js';
import { isRequestError, toGhDbError } from '../../../src/client/http-error.js';

function makeErr(status: number, headers: Record<string, string> = {}): RequestError {
  return new RequestError('test', status, {
    response: {
      url: 'https://api.github.com/x',
      status,
      headers,
      data: { message: 'test' },
    },
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
  });
}

describe('toGhDbError', () => {
  it('maps 401 to AuthError', () => {
    expect(toGhDbError(makeErr(401))).toBeInstanceOf(AuthError);
  });

  it('maps 403 without rate-limit to PermissionError', () => {
    expect(toGhDbError(makeErr(403))).toBeInstanceOf(PermissionError);
  });

  it('maps 403 with x-ratelimit-remaining: 0 to RateLimitError', () => {
    expect(toGhDbError(makeErr(403, { 'x-ratelimit-remaining': '0' }))).toBeInstanceOf(
      RateLimitError,
    );
  });

  it('maps 404 to NotFoundError', () => {
    expect(toGhDbError(makeErr(404))).toBeInstanceOf(NotFoundError);
  });

  it('maps 422 to ValidationError', () => {
    expect(toGhDbError(makeErr(422))).toBeInstanceOf(ValidationError);
  });

  it('maps 429 to RateLimitError', () => {
    expect(toGhDbError(makeErr(429))).toBeInstanceOf(RateLimitError);
  });

  it('maps 5xx to ServerError', () => {
    expect(toGhDbError(makeErr(502))).toBeInstanceOf(ServerError);
  });

  it('maps transport errors to NetworkError', () => {
    const err = Object.assign(new Error('net'), { code: 'ETIMEDOUT' });
    expect(toGhDbError(err)).toBeInstanceOf(NetworkError);
  });
});

describe('isRequestError', () => {
  it('returns true for Octokit RequestError', () => {
    expect(isRequestError(makeErr(500))).toBe(true);
  });

  it('returns false for plain errors', () => {
    expect(isRequestError(new Error('x'))).toBe(false);
    expect(isRequestError(null)).toBe(false);
  });
});
