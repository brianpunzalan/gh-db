import { Octokit } from '@octokit/rest';
import { runWithRetry } from '../retry/retry-loop.js';

/** Options for {@link createOctokitClient}. */
export interface OctokitClientOptions {
  /** GitHub personal access token. */
  auth: string;
  /** GitHub API base URL (default `https://api.github.com`). */
  baseUrl?: string;
  /** User-Agent header value. */
  userAgent: string;
  /** Transient-error retry attempts. */
  retryMaxAttempts: number;
  /** Base delay (ms) for transient-error backoff. */
  retryBaseDelayMs: number;
}

/** Default GitHub REST API base URL. */
export const DEFAULT_GITHUB_BASE_URL = 'https://api.github.com';

/** API version pinned per contracts/github-endpoints.md. */
export const GITHUB_API_VERSION = '2022-11-28';

/** Default Accept header value pinned per contracts/github-endpoints.md. */
export const DEFAULT_ACCEPT = 'application/vnd.github+json';

/**
 * Construct an Octokit instance configured for a single gh-db instance.
 *
 * The retry layer is installed via `octokit.hook.wrap('request', ...)`
 * so every endpoint call passes through the bounded exponential backoff
 * loop. Configuration mirrors R-006: transient categories (rate-limit,
 * 5xx, network) retry up to the attempt budget; permanent categories
 * surface immediately.
 *
 * @param options See {@link OctokitClientOptions}.
 * @returns A configured {@link Octokit} instance.
 */
export function createOctokitClient(options: OctokitClientOptions): Octokit {
  const octokit = new Octokit({
    auth: options.auth,
    baseUrl: options.baseUrl ?? DEFAULT_GITHUB_BASE_URL,
    userAgent: options.userAgent,
  });

  // Wrap every request through the retry loop. The hook signature gives
  // us a `request` function plus the prepared `options` (URL, headers,
  // body). We delegate execution to `runWithRetry` and let it classify
  // any thrown Octokit RequestError.
  octokit.hook.wrap('request', (request, requestOptions) => {
    const headers = {
      ...(requestOptions.headers ?? {}),
    } as Record<string, string>;
    if (!headers['accept']) headers['accept'] = DEFAULT_ACCEPT;
    if (!headers['x-github-api-version']) {
      headers['x-github-api-version'] = GITHUB_API_VERSION;
    }
    const wrappedOptions = { ...requestOptions, headers } as typeof requestOptions;
    return runWithRetry(() => Promise.resolve(request(wrappedOptions)), {
      maxAttempts: options.retryMaxAttempts,
      baseDelayMs: options.retryBaseDelayMs,
    });
  });

  return octokit;
}
