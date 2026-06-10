import { GhDbError, RetryExhaustedError, type RetryExhaustedUnderlying } from '../errors/index.js';
import { computeBackoffMs, sleep } from './backoff.js';
import { classifyError } from './classify.js';

/** Options accepted by {@link runWithRetry}. */
export interface RetryLoopOptions {
  /** Hard cap on attempts (initial try + retries). */
  maxAttempts: number;
  /** Base delay (ms) for exponential backoff. */
  baseDelayMs: number;
  /** Optional deterministic RNG (returns [0,1)) for tests. */
  random?: () => number;
  /** Optional clock for tests. */
  now?: () => number;
  /** Optional sleep override for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Map a classified rate-limit/server/network error to the underlying
 * category recorded on {@link RetryExhaustedError}.
 *
 * @param code The gh-db error code from the last classified error.
 * @returns The matching `'rate_limit' | 'server' | 'network'` literal.
 */
function underlyingCategory(code: string): RetryExhaustedUnderlying {
  if (code === 'rate_limit') return 'rate_limit';
  if (code === 'server') return 'server';
  return 'network';
}

/**
 * Run `fn` with bounded exponential backoff for transient errors.
 *
 * Transient categories (rate-limit, server 5xx, network) are retried up
 * to `maxAttempts` total tries. Permanent errors surface immediately so
 * the caller sees the typed gh-db error class without delay. Exhaustion
 * surfaces a typed {@link RetryExhaustedError} carrying the underlying
 * category, the attempts made, and any reset hint from the last
 * response.
 *
 * @param fn Async callable to execute.
 * @param options See {@link RetryLoopOptions}.
 * @returns Whatever `fn` resolves with on a successful attempt.
 * @throws {GhDbError} The classified gh-db error on permanent failure.
 * @throws {RetryExhaustedError} When the attempt budget is consumed.
 */
export async function runWithRetry<T>(fn: () => Promise<T>, options: RetryLoopOptions): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const sleepFn = options.sleep ?? sleep;
  let lastError: GhDbError | undefined;
  let lastResetAt: Date | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Classification produces both the retry decision AND the typed
      // gh-db error to surface; we keep the most recent one so we can
      // hand it to the exhaustion error as `cause`.
      const classified = classifyError(err);
      lastError = classified.error;
      lastResetAt = classified.resetAt;

      if (classified.category === 'permanent') {
        throw classified.error;
      }
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) {
        break;
      }
      const delayOpts: Parameters<typeof computeBackoffMs>[0] = {
        attempt,
        baseDelayMs: options.baseDelayMs,
        ...(options.random ? { random: options.random } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(classified.resetAt ? { resetAt: classified.resetAt } : {}),
      };
      const delay = computeBackoffMs(delayOpts);
      await sleepFn(delay);
    }
  }

  // Budget consumed — surface a terminal error with full provenance so
  // operators can correlate it with rate-limit dashboards.
  throw new RetryExhaustedError(`Retry budget exhausted after ${maxAttempts} attempts.`, {
    underlying: lastError ? underlyingCategory(lastError.code) : 'network',
    attempts: maxAttempts,
    ...(lastResetAt ? { resetAt: lastResetAt } : {}),
    cause: lastError,
  });
}
