import { describe, expect, it } from 'vitest';
import { RequestError } from '@octokit/request-error';
import {
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../../../src/errors/index.js';
import { classifyError } from '../../../src/retry/classify.js';

interface FakeRequestErrorOptions {
  status: number;
  message: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function makeRequestError(opts: FakeRequestErrorOptions): RequestError {
  return new RequestError(opts.message, opts.status, {
    response: {
      url: 'https://api.github.com/test',
      status: opts.status,
      headers: opts.headers ?? {},
      data: opts.body,
    },
    request: {
      method: 'GET',
      url: 'https://api.github.com/test',
      headers: {},
    },
  });
}

describe('classifyError', () => {
  it('401 → AuthError, permanent', () => {
    const c = classifyError(makeRequestError({ status: 401, message: 'Bad creds' }));
    expect(c.category).toBe('permanent');
    expect(c.error).toBeInstanceOf(AuthError);
  });

  it('403 with x-ratelimit-remaining: 0 → RateLimitError (secondary), transient', () => {
    const c = classifyError(
      makeRequestError({
        status: 403,
        message: 'rate limit',
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
      }),
    );
    expect(c.category).toBe('transient');
    expect(c.error).toBeInstanceOf(RateLimitError);
    expect((c.error as RateLimitError).kind).toBe('secondary');
  });

  it('403 without rate-limit → PermissionError, permanent', () => {
    const c = classifyError(makeRequestError({ status: 403, message: 'forbidden' }));
    expect(c.category).toBe('permanent');
    expect(c.error).toBeInstanceOf(PermissionError);
  });

  it('404 → NotFoundError, permanent', () => {
    const c = classifyError(makeRequestError({ status: 404, message: 'not found' }));
    expect(c.category).toBe('permanent');
    expect(c.error).toBeInstanceOf(NotFoundError);
  });

  it('422 not fast-forward → ConflictError, permanent', () => {
    const c = classifyError(
      makeRequestError({
        status: 422,
        message: 'Update is not a fast forward',
        body: { message: 'Update is not a fast forward' },
      }),
    );
    expect(c.category).toBe('permanent');
    expect(c.error).toBeInstanceOf(ConflictError);
  });

  it('422 other → ValidationError, permanent', () => {
    const c = classifyError(
      makeRequestError({
        status: 422,
        message: 'Validation Failed',
        body: { message: 'Validation Failed', errors: [{ message: 'bad input' }] },
      }),
    );
    expect(c.category).toBe('permanent');
    expect(c.error).toBeInstanceOf(ValidationError);
  });

  it('429 → RateLimitError (primary), transient', () => {
    const c = classifyError(
      makeRequestError({
        status: 429,
        message: 'rate limit',
        headers: { 'retry-after': '5' },
      }),
    );
    expect(c.category).toBe('transient');
    expect(c.error).toBeInstanceOf(RateLimitError);
    expect((c.error as RateLimitError).kind).toBe('primary');
    expect((c.error as RateLimitError).resetAt).toBeInstanceOf(Date);
  });

  it('500 → ServerError, transient', () => {
    const c = classifyError(makeRequestError({ status: 500, message: 'boom' }));
    expect(c.category).toBe('transient');
    expect(c.error).toBeInstanceOf(ServerError);
    expect((c.error as ServerError).status).toBe(500);
  });

  it('503 → ServerError, transient', () => {
    const c = classifyError(makeRequestError({ status: 503, message: 'down' }));
    expect(c.category).toBe('transient');
    expect(c.error).toBeInstanceOf(ServerError);
  });

  it('network error (ECONNRESET) → NetworkError, transient', () => {
    const err = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
    const c = classifyError(err);
    expect(c.category).toBe('transient');
    expect(c.error).toBeInstanceOf(NetworkError);
  });

  it('parses Retry-After as seconds-from-now', () => {
    const c = classifyError(
      makeRequestError({
        status: 429,
        message: 'rate limit',
        headers: { 'retry-after': '60' },
      }),
    );
    expect(c.resetAt).toBeInstanceOf(Date);
    const diff = c.resetAt!.getTime() - Date.now();
    expect(diff).toBeGreaterThan(50_000);
    expect(diff).toBeLessThan(65_000);
  });
});
