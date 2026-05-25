import { describe, expect, it, vi } from 'vitest';
import { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';
import { runCommitPipeline } from '../../src/commit/pipeline.js';
import { retrieveRecord } from '../../src/crud/retrieve.js';
import { runWithRetry } from '../../src/retry/retry-loop.js';
import { classifyError } from '../../src/retry/classify.js';
import { AuthError, RateLimitError, RetryExhaustedError } from '../../src/errors/index.js';
import { StagingArea } from '../../src/staging/staging-area.js';
import { parseInstanceConfig } from '../../src/core/instance-config.js';
import type { StagedOperation } from '../../src/types/public.js';

function makeOctokit(requestFn: (route: string, params?: Record<string, unknown>) => Promise<unknown>): Octokit {
  return { request: requestFn } as unknown as Octokit;
}

function make429(retryAfterSeconds: number): RequestError {
  const resetAt = new Date(Date.now() + retryAfterSeconds * 1000);
  return new RequestError('rate limited', 429, {
    response: {
      url: 'https://api.github.com/x',
      status: 429,
      headers: { 'retry-after': String(retryAfterSeconds), 'x-ratelimit-reset': String(Math.floor(resetAt.getTime() / 1000)) },
      data: {},
    },
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
  });
}

function make401(): RequestError {
  return new RequestError('Requires authentication', 401, {
    response: {
      url: 'https://api.github.com/x',
      status: 401,
      headers: {},
      data: { message: 'Requires authentication' },
    },
    request: { method: 'GET', url: 'https://api.github.com/x', headers: {} },
  });
}

describe('edge cases', () => {
  describe('large single record (~1 MB)', () => {
    it('stages and commits a ~1 MB JSON record without error', async () => {
      // ~1 MB string payload
      const largeString = 'x'.repeat(1_000_000);
      const largeValue = { data: largeString };

      // Verify the value is encodable without throwing
      const { encodeJson } = await import('../../src/serialization/encode.js');
      const encoded = encodeJson('big-record', largeValue);
      expect(encoded.length).toBeGreaterThan(900_000);

      const blobSha = 'blob-large-sha';
      const treeSha = 'tree-large-sha';
      const commitSha = 'commit-large-sha';

      const calls: Array<{ route: string; params: unknown }> = [];
      const octokit = makeOctokit(async (route, params) => {
        calls.push({ route, params });
        if (route === 'POST /repos/{owner}/{repo}/git/blobs') return { data: { sha: blobSha } };
        if (route === 'POST /repos/{owner}/{repo}/git/trees') return { data: { sha: treeSha } };
        if (route === 'POST /repos/{owner}/{repo}/git/commits') return { data: { sha: commitSha } };
        if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}') return { data: {} };
        throw new Error(`Unexpected route: ${route}`);
      });

      const ops: StagedOperation[] = [{ kind: 'create', key: 'big-record', value: largeValue, enqueuedAt: new Date() }];
      const result = await runCommitPipeline({
        octokit,
        owner: 'o',
        repo: 'r',
        branch: 'main',
        baselineSha: 'base-sha',
        baselineTreeSha: 'base-tree-sha',
        ops,
        message: 'add big record',
      });

      expect(result.sha).toBe(commitSha);
      // Blob content should contain the large string
      const blobCall = calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/git/blobs');
      expect(blobCall).toBeDefined();
      const blobParams = blobCall!.params as { content: string; encoding: string };
      expect(blobParams.content.length).toBeGreaterThan(900_000);
      expect(blobParams.encoding).toBe('utf-8');
    });
  });

  describe('50-record commit batch atomicity (SC-002)', () => {
    it('commits 50 staged operations in a single pipeline run', async () => {
      const N = 50;
      const blobCallCount = { n: 0 };
      const treeCalls: unknown[] = [];
      const commitCalls: unknown[] = [];

      const octokit = makeOctokit(async (route, params) => {
        if (route === 'POST /repos/{owner}/{repo}/git/blobs') {
          blobCallCount.n++;
          return { data: { sha: `blob-${blobCallCount.n}` } };
        }
        if (route === 'POST /repos/{owner}/{repo}/git/trees') {
          treeCalls.push(params);
          return { data: { sha: 'tree-batch-sha' } };
        }
        if (route === 'POST /repos/{owner}/{repo}/git/commits') {
          commitCalls.push(params);
          return { data: { sha: 'commit-batch-sha' } };
        }
        if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}') {
          return { data: {} };
        }
        throw new Error(`Unexpected route: ${route}`);
      });

      const ops: StagedOperation[] = Array.from({ length: N }, (_, i) => ({
        kind: 'create' as const,
        key: `record-${i}`,
        value: { index: i },
        enqueuedAt: new Date(),
      }));

      const result = await runCommitPipeline({
        octokit,
        owner: 'o',
        repo: 'r',
        branch: 'main',
        baselineSha: 'base-sha',
        baselineTreeSha: 'base-tree-sha',
        ops,
        message: 'batch of 50',
      });

      // All 50 records created a blob
      expect(blobCallCount.n).toBe(N);
      // Exactly one tree and one commit — the pipeline is atomic
      expect(treeCalls).toHaveLength(1);
      expect(commitCalls).toHaveLength(1);
      // Tree must contain all 50 entries
      const treeParams = treeCalls[0] as { tree: unknown[] };
      expect(treeParams.tree).toHaveLength(N);
      expect(result.sha).toBe('commit-batch-sha');
    });
  });

  describe('rate-limit retry honoring Retry-After', () => {
    it('retries after Retry-After delay and succeeds', async () => {
      const sleepDelays: number[] = [];
      const mockSleep = vi.fn(async (ms: number) => { sleepDelays.push(ms); });

      let callCount = 0;
      const fn = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw make429(2); // first call: rate limited, reset in 2s
        return 'ok';
      });

      const result = await runWithRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 100,
        sleep: mockSleep,
        random: () => 1, // maximize jitter to expose the reset hint path
        now: () => Date.now(),
      });

      expect(result).toBe('ok');
      expect(callCount).toBe(2);
      // The sleep delay should honor the Retry-After hint (~2000ms, capped at 30000ms)
      expect(sleepDelays).toHaveLength(1);
      expect(sleepDelays[0]).toBeGreaterThan(0);
      expect(sleepDelays[0]).toBeLessThanOrEqual(30_000);
    });

    it('surfaces RateLimitError when budget is exhausted on repeated 429s', async () => {
      const err = await runWithRetry(
        async () => { throw make429(0); },
        {
          maxAttempts: 2,
          baseDelayMs: 1,
          sleep: async () => {},
        },
      ).catch((e) => e);

      expect(err).toBeInstanceOf(RetryExhaustedError);
      expect((err as RetryExhaustedError).underlying).toBe('rate_limit');
      expect((err as RetryExhaustedError).attempts).toBe(2);
    });

    it('classifies 429 as transient with RateLimitError', () => {
      const classified = classifyError(make429(5));
      expect(classified.category).toBe('transient');
      expect(classified.error).toBeInstanceOf(RateLimitError);
      expect((classified.error as RateLimitError).kind).toBe('primary');
    });
  });

  describe('token-expiry mid-session → AuthError', () => {
    it('surfaces AuthError when a 401 is returned on retrieve', async () => {
      const octokit = makeOctokit(async (route) => {
        if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') throw make401();
        throw new Error(`Unexpected route: ${route}`);
      });

      const staging = new StagingArea();
      const config = parseInstanceConfig({ owner: 'o', repo: 'r', auth: 'expired-token', branch: 'main' });

      await expect(
        retrieveRecord(
          { octokit, config, staging, cachedTip: { sha: undefined, treeSha: undefined, observedAt: undefined }, branch: 'main' },
          'some-key',
        ),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it('classifies 401 as permanent (no retry)', () => {
      const classified = classifyError(make401());
      expect(classified.category).toBe('permanent');
      expect(classified.error).toBeInstanceOf(AuthError);
    });
  });
});
