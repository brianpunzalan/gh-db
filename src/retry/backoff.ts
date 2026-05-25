/** Upper bound on any single backoff delay (ms). */
export const MAX_BACKOFF_MS = 30_000;

/** Options accepted by {@link computeBackoffMs}. */
export interface BackoffOptions {
  /** Zero-based attempt number (0 for the first retry, etc.). */
  attempt: number;
  /** Base delay (ms). */
  baseDelayMs: number;
  /** Optional absolute reset hint from `Retry-After` / `X-RateLimit-Reset`. */
  resetAt?: Date;
  /** Optional deterministic RNG (returns [0,1)) for tests. Defaults to `Math.random`. */
  random?: () => number;
  /** Optional clock for tests; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Compute the delay (ms) before the next retry attempt.
 *
 * Schedule: `min(baseDelay * 2^attempt, 30s)` with full jitter
 * (R-006). If a reset hint is present (from `Retry-After` or
 * `X-RateLimit-Reset`), the delay is set to honor that hint instead,
 * clamped to the same 30s upper bound.
 *
 * @param options See {@link BackoffOptions}.
 * @returns Delay in milliseconds, always >= 0 and <= 30000.
 */
export function computeBackoffMs(options: BackoffOptions): number {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  if (options.resetAt) {
    // GitHub gave us an explicit hint; respect it but never sleep longer
    // than our self-imposed upper bound so we cannot stall a process
    // indefinitely. A negative diff (clock skew, expired hint) collapses
    // to 0 so the loop retries promptly.
    const diff = options.resetAt.getTime() - now();
    if (diff <= 0) return 0;
    return Math.min(diff, MAX_BACKOFF_MS);
  }

  // Cap the exponent so 2^attempt does not overflow into Infinity for
  // pathological inputs.
  const safeAttempt = Math.max(0, Math.min(20, Math.floor(options.attempt)));
  const ceiling = Math.min(options.baseDelayMs * 2 ** safeAttempt, MAX_BACKOFF_MS);
  // Full jitter: choose uniformly in [0, ceiling). This avoids the
  // thundering-herd retry pile-up that uniform backoff produces.
  return Math.floor(random() * ceiling);
}

/**
 * Pause execution for `ms` milliseconds.
 *
 * @param ms Delay in milliseconds.
 * @returns A Promise that resolves after the delay.
 */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
