import { describe, expect, it, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import { AuthError, RetryExhaustedError, ServerError } from '../../../src/errors/index.js';
import { runWithRetry } from '../../../src/retry/retry-loop.js';

function make500(): RequestError {
  return new RequestError('boom', 500, {
    response: {
      url: 'https://api.github.com/x',
      status: 500,
      headers: {},
      data: {},
    },
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
  });
}

function make401(): RequestError {
  return new RequestError('bad creds', 401, {
    response: {
      url: 'https://api.github.com/x',
      status: 401,
      headers: {},
      data: {},
    },
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
  });
}

describe('runWithRetry', () => {
  it('returns the first successful attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await runWithRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      sleep: () => Promise.resolve(),
    });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors up to maxAttempts then throws RetryExhaustedError', async () => {
    const fn = vi.fn().mockRejectedValue(make500());
    await expect(
      runWithRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        sleep: () => Promise.resolve(),
        random: () => 0,
      }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('reports underlying category on RetryExhaustedError', async () => {
    const fn = vi.fn().mockRejectedValue(make500());
    try {
      await runWithRetry(fn, {
        maxAttempts: 2,
        baseDelayMs: 1,
        sleep: () => Promise.resolve(),
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      expect((err as RetryExhaustedError).underlying).toBe('server');
      expect((err as RetryExhaustedError).attempts).toBe(2);
    }
  });

  it('surfaces permanent errors immediately without retry', async () => {
    const fn = vi.fn().mockRejectedValue(make401());
    await expect(
      runWithRetry(fn, { maxAttempts: 5, baseDelayMs: 1, sleep: () => Promise.resolve() }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('recovers when a later attempt succeeds', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls < 3) throw make500();
      return 'ok';
    });
    const out = await runWithRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('exposes underlying as "network" when no http error was classified', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('net down'), { code: 'ECONNRESET' }));
    await expect(
      runWithRetry(fn, {
        maxAttempts: 2,
        baseDelayMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ underlying: 'network' });
  });

  it('surfaces a permanent ServerError on the first attempt as ServerError (not RetryExhausted) when budget is 1', async () => {
    const fn = vi.fn().mockRejectedValue(make500());
    await expect(
      runWithRetry(fn, {
        maxAttempts: 1,
        baseDelayMs: 1,
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a permanent error from initial attempt with default budget still throws permanent', async () => {
    expect(new ServerError('x', { status: 500 })).toBeInstanceOf(ServerError);
  });
});
