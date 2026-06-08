import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';
import { startWatch } from '../../../src/watch/watch.js';
import type { WatchContext } from '../../../src/watch/watch.js';
import { KeyValidationError } from '../../../src/errors/index.js';

vi.useFakeTimers();

/** Flush pending microtasks without advancing fake timers. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

const BASE64_HELLO = btoa(JSON.stringify({ turn: 1 }));

function makeOctokit(impl: () => Promise<unknown>): Octokit {
  return { request: vi.fn(impl) } as unknown as Octokit;
}

function makeCtx(octokit: Octokit): WatchContext {
  return {
    octokit,
    config: {
      owner: 'o',
      repo: 'r',
      branch: undefined,
      baseUrl: 'https://api.github.com',
      auth: 'token',
      conflictPolicy: 'fail',
      conflictMaxAttempts: 3,
      readConsistency: 'fresh',
      retryMaxAttempts: 3,
      retryBaseDelayMs: 500,
      userAgent: 'gh-db/test',
    },
    branch: 'main',
  };
}

function makeRequestError(status: number): RequestError {
  const url = 'https://api.github.com/repos/o/r/contents/board.json';
  return new RequestError('error', status, {
    response: { url, status, headers: {}, data: {} },
    request: { method: 'GET', url, headers: {} },
  });
}

describe('startWatch', () => {
  beforeEach(() => vi.clearAllTimers());
  afterEach(() => vi.clearAllTimers());

  it('calls callback with found result on first successful poll', async () => {
    const octokit = makeOctokit(() =>
      Promise.resolve({
        data: { content: BASE64_HELLO, encoding: 'base64' },
        headers: { etag: '"abc123"' },
      }),
    );
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback);

    await flushMicrotasks(); // first poll runs immediately (no setTimeout)
    handle.unsubscribe();

    expect(callback).toHaveBeenCalledWith(null, { found: true, value: { turn: 1 } });
  });

  it('does not call callback when GitHub returns 304 (ETag match)', async () => {
    const octokit = makeOctokit(() => Promise.reject(makeRequestError(304)));
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback);

    await flushMicrotasks();
    handle.unsubscribe();

    expect(callback).not.toHaveBeenCalled();
  });

  it('calls callback with { found: false } when GitHub returns 404', async () => {
    const octokit = makeOctokit(() => Promise.reject(makeRequestError(404)));
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback);

    await flushMicrotasks();
    handle.unsubscribe();

    expect(callback).toHaveBeenCalledWith(null, { found: false });
  });

  it('calls callback with error on non-304/non-404 API failure', async () => {
    const octokit = makeOctokit(() => Promise.reject(makeRequestError(500)));
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback);

    await flushMicrotasks();
    handle.unsubscribe();

    expect(callback).toHaveBeenCalledWith(expect.any(Error), undefined);
  });

  it('sends If-None-Match header on subsequent polls after receiving ETag', async () => {
    let callCount = 0;
    const octokit = makeOctokit(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          data: { content: BASE64_HELLO, encoding: 'base64' },
          headers: { etag: '"etag-v1"' },
        });
      }
      return Promise.reject(makeRequestError(304));
    });
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback, { intervalMs: 1000 });

    await flushMicrotasks(); // first poll
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // fires second poll timer and awaits it
    handle.unsubscribe();

    const requests = vi.mocked(octokit.request).mock.calls;
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const secondHeaders = (requests[1]![1] as Record<string, unknown>)[
      'headers'
    ] as Record<string, string>;
    expect(secondHeaders['if-none-match']).toBe('"etag-v1"');
  });

  it('stops polling after unsubscribe()', async () => {
    const octokit = makeOctokit(() =>
      Promise.resolve({
        data: { content: BASE64_HELLO, encoding: 'base64' },
        headers: {},
      }),
    );
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback, { intervalMs: 1000 });

    await flushMicrotasks(); // first poll
    expect(callback).toHaveBeenCalledTimes(1);

    handle.unsubscribe();

    // advance past several intervals — active=false so no further callbacks
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('enforces minimum intervalMs of 1000', async () => {
    const octokit = makeOctokit(() =>
      Promise.resolve({
        data: { content: BASE64_HELLO, encoding: 'base64' },
        headers: {},
      }),
    );
    const callback = vi.fn();
    const handle = startWatch(makeCtx(octokit), 'board', callback, { intervalMs: 10 });

    await flushMicrotasks(); // first poll
    expect(callback).toHaveBeenCalledTimes(1);

    // 500ms — second poll hasn't fired yet (clamped to 1000ms interval)
    await vi.advanceTimersByTimeAsync(500);
    expect(callback).toHaveBeenCalledTimes(1);

    // 1000ms total — second poll fires
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();
    handle.unsubscribe();

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('throws KeyValidationError synchronously for an invalid key', () => {
    const octokit = makeOctokit(() => Promise.resolve({ data: {}, headers: {} }));
    expect(() => startWatch(makeCtx(octokit), '', vi.fn())).toThrow(KeyValidationError);
  });
});
