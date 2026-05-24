import { RequestError } from '@octokit/request-error';
import {
  AuthError,
  ConflictError,
  GhDbError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../errors/index.js';

/**
 * What the retry layer should do with a classified error.
 *
 * - `'transient'`: eligible for backoff + retry (FR-027 / FR-028).
 * - `'permanent'`: surface immediately, never retry.
 */
export type RetryCategory = 'transient' | 'permanent';

/** Result of classifying an error against the retry decision table. */
export interface ClassifiedError {
  /** Retry decision for the surrounding loop. */
  category: RetryCategory;
  /** The typed gh-db error to throw on the no-retry path. */
  error: GhDbError;
  /** Optional reset hint surfaced from rate-limit responses. */
  resetAt?: Date;
}

/**
 * Classify an Octokit / native error into a retry decision + a typed
 * gh-db error.
 *
 * Maps every row of the HTTP table in contracts/errors.md. Transient
 * rows (`429`, `403 + x-ratelimit-remaining: 0`, `5xx`, transport-level
 * errors) are eligible for retry; everything else is permanent. The
 * commit pipeline's 422 not-fast-forward is intentionally returned as a
 * permanent ConflictError — the higher-level conflict policy
 * (R-004) handles retry for that case.
 *
 * @param err The error to classify (typically thrown by Octokit).
 * @returns A {@link ClassifiedError} describing how to handle it.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof RequestError) {
    return classifyRequestError(err);
  }
  // Anything that looks like a transport-level failure (no response was
  // ever received) is transient — the network may recover on retry.
  if (isNetworkLikeError(err)) {
    return {
      category: 'transient',
      error: new NetworkError(
        err instanceof Error ? err.message : 'Network error contacting GitHub.',
        { cause: err },
      ),
    };
  }
  // Genuine bugs / unexpected exceptions bubble up as permanent so the
  // retry loop does not mask them.
  return {
    category: 'permanent',
    error:
      err instanceof GhDbError
        ? err
        : new GhDbError('server', err instanceof Error ? err.message : 'Unknown error.', {
            cause: err,
          }),
  };
}

/**
 * Classify a {@link RequestError} from Octokit.
 *
 * @param err The Octokit request error.
 * @returns A {@link ClassifiedError} describing how to handle it.
 */
function classifyRequestError(err: RequestError): ClassifiedError {
  const status = err.status;
  const headers = (err.response?.headers ?? {}) as Record<string, string | string[] | undefined>;
  const remaining = headerValue(headers, 'x-ratelimit-remaining');
  const resetHeader = headerValue(headers, 'x-ratelimit-reset');
  const retryAfter = headerValue(headers, 'retry-after');
  const resetAt = parseResetHint(retryAfter, resetHeader);

  if (status === 401) {
    return {
      category: 'permanent',
      error: new AuthError('GitHub rejected the credentials.', { cause: err }),
    };
  }
  if (status === 403) {
    if (remaining === '0') {
      const out: ClassifiedError = {
        category: 'transient',
        error: new RateLimitError('Secondary rate limit hit.', {
          kind: 'secondary',
          ...(resetAt ? { resetAt } : {}),
          cause: err,
        }),
      };
      if (resetAt) out.resetAt = resetAt;
      return out;
    }
    return {
      category: 'permanent',
      error: new PermissionError(
        'GitHub returned 403 (permission denied). The token may lack the required scope.',
        { cause: err },
      ),
    };
  }
  if (status === 404) {
    return {
      category: 'permanent',
      error: new NotFoundError('GitHub resource not found.', {
        resourceKind: 'repo',
        cause: err,
      }),
    };
  }
  if (status === 422) {
    if (isNotFastForwardError(err)) {
      // The commit pipeline raises its own ConflictError with the
      // baseline/remote SHAs already populated; classify here only to
      // mark the error as permanent so the retry loop steps aside.
      return {
        category: 'permanent',
        error: new ConflictError('Update is not a fast-forward.', {
          baselineSha: '',
          remoteSha: '',
          cause: err,
        }),
      };
    }
    return {
      category: 'permanent',
      error: new ValidationError('GitHub rejected the request as invalid.', {
        subcode: 'invalid_input',
        cause: err,
      }),
    };
  }
  if (status === 429) {
    const out: ClassifiedError = {
      category: 'transient',
      error: new RateLimitError('Primary rate limit hit.', {
        kind: 'primary',
        ...(resetAt ? { resetAt } : {}),
        cause: err,
      }),
    };
    if (resetAt) out.resetAt = resetAt;
    return out;
  }
  if (status >= 500 && status <= 599) {
    return {
      category: 'transient',
      error: new ServerError(`GitHub server error (${status}).`, {
        status,
        cause: err,
      }),
    };
  }
  // Any other unexpected status is treated as permanent so it does not
  // mask future contract drift.
  return {
    category: 'permanent',
    error: new GhDbError('server', `Unexpected GitHub status ${status}.`, {
      cause: err,
    }),
  };
}

/**
 * Read a single header value case-insensitively from Octokit's header bag.
 *
 * @param headers Header object returned by Octokit.
 * @param name Header name (lowercased).
 * @returns The first string value or undefined.
 */
function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (Array.isArray(direct)) return direct[0];
  if (typeof direct === 'string') return direct;
  return undefined;
}

/**
 * Parse a `Retry-After` (seconds-from-now) or `X-RateLimit-Reset`
 * (unix seconds) hint into an absolute Date.
 *
 * @param retryAfter The `Retry-After` header value.
 * @param resetEpoch The `X-RateLimit-Reset` header value.
 * @returns A wall-clock Date hint or undefined.
 */
function parseResetHint(retryAfter: string | undefined, resetEpoch: string | undefined): Date | undefined {
  if (retryAfter !== undefined) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return new Date(Date.now() + seconds * 1000);
    }
    const parsed = Date.parse(retryAfter);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  if (resetEpoch !== undefined) {
    const seconds = Number(resetEpoch);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000);
    }
  }
  return undefined;
}

/**
 * Detect the GitHub "Update is not a fast-forward" 422 (which signals a
 * commit-pipeline conflict, not a generic validation failure).
 *
 * @param err Octokit request error.
 * @returns True when the response message indicates a non-fast-forward.
 */
function isNotFastForwardError(err: RequestError): boolean {
  const body = err.response?.data as { message?: string } | undefined;
  const msg = body?.message ?? err.message ?? '';
  return /not\s*a\s*fast[-\s]?forward/i.test(msg);
}

/**
 * Detect transport-level errors (no HTTP response).
 *
 * @param err Arbitrary thrown value.
 * @returns True when the error looks like a network failure.
 */
function isNetworkLikeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'EAI_AGAIN' ||
    code === 'EPIPE'
  ) {
    return true;
  }
  return /network|fetch failed|socket hang up/i.test(err.message);
}
