import { GhDbError } from '../errors/index.js';
import type {
  ConflictPolicy,
  GhDbConfig,
  ReadConsistencyPolicy,
} from '../types/public.js';

/** Default GitHub REST API base URL. */
const DEFAULT_BASE_URL = 'https://api.github.com';

/** Default conflict policy. */
const DEFAULT_CONFLICT_POLICY: ConflictPolicy = 'fail';

/** Default read-consistency policy. */
const DEFAULT_READ_CONSISTENCY: ReadConsistencyPolicy = 'fresh';

/** Default attempt budget for `retry` / `rebase` conflict policies. */
const DEFAULT_CONFLICT_MAX_ATTEMPTS = 3;

/** Hard upper limit for `conflictMaxAttempts`. */
const MAX_CONFLICT_MAX_ATTEMPTS = 10;

/** Default attempt budget for transient-error retry. */
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;

/** Hard upper limit for `retryMaxAttempts`. */
const MAX_RETRY_MAX_ATTEMPTS = 10;

/** Default base delay (ms) for transient-error retry backoff. */
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

/** Hard upper limit for `retryBaseDelayMs`. */
const MAX_RETRY_BASE_DELAY_MS = 5000;

/** Hard lower limit for `retryBaseDelayMs`. */
const MIN_RETRY_BASE_DELAY_MS = 1;

/** Internal package version, injected into the default User-Agent. */
const PACKAGE_VERSION = '0.1.0';

/** Parsed + validated instance configuration. Immutable. */
export interface InstanceConfig {
  /** GitHub owner login. */
  readonly owner: string;
  /** Repository name. */
  readonly repo: string;
  /** Working branch (may be undefined until resolved from GitHub). */
  readonly branch: string | undefined;
  /** API base URL. */
  readonly baseUrl: string;
  /** GitHub PAT. */
  readonly auth: string;
  /** Conflict-policy default. */
  readonly conflictPolicy: ConflictPolicy;
  /** Max attempts for `retry` / `rebase` policies. */
  readonly conflictMaxAttempts: number;
  /** Read-consistency mode. */
  readonly readConsistency: ReadConsistencyPolicy;
  /** Transient-error retry attempts. */
  readonly retryMaxAttempts: number;
  /** Base delay (ms) for transient-error backoff. */
  readonly retryBaseDelayMs: number;
  /** `User-Agent` header value. */
  readonly userAgent: string;
}

/**
 * Validate caller-supplied {@link GhDbConfig} and return an immutable,
 * fully-resolved {@link InstanceConfig}.
 *
 * Numeric bounds are clamped into their documented ranges (R-014 /
 * R-006). Literal-union fields (`conflictPolicy`, `readConsistency`) are
 * validated against their allowed values.
 *
 * @param config Caller-supplied configuration.
 * @returns An immutable instance config.
 * @throws {GhDbError} when a required field is missing/invalid.
 */
export function parseInstanceConfig(config: GhDbConfig): InstanceConfig {
  requireNonEmptyString('owner', config.owner);
  requireNonEmptyString('repo', config.repo);
  requireNonEmptyString('auth', config.auth);
  if (config.owner.includes('/') || /\s/.test(config.owner)) {
    throw new GhDbError('validation', `Invalid 'owner': ${config.owner}`);
  }
  if (config.repo.includes('/') || /\s/.test(config.repo)) {
    throw new GhDbError('validation', `Invalid 'repo': ${config.repo}`);
  }

  const branch =
    config.branch !== undefined ? validateBranch(config.branch) : undefined;
  const baseUrl = validateBaseUrl(config.baseUrl);
  const conflictPolicy = validateConflictPolicy(config.conflictPolicy);
  const readConsistency = validateReadConsistency(config.readConsistency);
  const conflictMaxAttempts = clamp(
    config.conflictMaxAttempts ?? DEFAULT_CONFLICT_MAX_ATTEMPTS,
    1,
    MAX_CONFLICT_MAX_ATTEMPTS,
  );
  const retryMaxAttempts = clamp(
    config.retryMaxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS,
    1,
    MAX_RETRY_MAX_ATTEMPTS,
  );
  const retryBaseDelayMs = clamp(
    config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    MIN_RETRY_BASE_DELAY_MS,
    MAX_RETRY_BASE_DELAY_MS,
  );
  const userAgent =
    config.userAgent && config.userAgent.length > 0
      ? config.userAgent
      : `gh-db/${PACKAGE_VERSION}`;

  return Object.freeze({
    owner: config.owner,
    repo: config.repo,
    branch,
    baseUrl,
    auth: config.auth,
    conflictPolicy,
    conflictMaxAttempts,
    readConsistency,
    retryMaxAttempts,
    retryBaseDelayMs,
    userAgent,
  });
}

/**
 * Validate that a field is a non-empty trimmable string.
 *
 * @param field Name of the field (for the error message).
 * @param value Caller-supplied value.
 * @throws {GhDbError} when the value is empty or not a string.
 */
function requireNonEmptyString(field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GhDbError('validation', `Missing required config field: '${field}'.`);
  }
}

/**
 * Validate a branch name (basic shape only; GitHub itself is the
 * ultimate validator on first use).
 *
 * @param branch Caller-supplied branch name.
 * @returns The branch unchanged when valid.
 * @throws {GhDbError} when the branch is empty / whitespace-only.
 */
function validateBranch(branch: string): string {
  if (typeof branch !== 'string' || branch.trim().length === 0) {
    throw new GhDbError('validation', `Invalid 'branch': must be a non-empty string.`);
  }
  return branch;
}

/**
 * Validate the `baseUrl` config field, defaulting to api.github.com.
 *
 * @param baseUrl Caller-supplied value (optional).
 * @returns The resolved base URL.
 * @throws {GhDbError} when the supplied URL cannot be parsed.
 */
function validateBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined) return DEFAULT_BASE_URL;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported protocol');
    }
    return baseUrl;
  } catch (err) {
    throw new GhDbError('validation', `Invalid 'baseUrl': ${baseUrl}`, { cause: err });
  }
}

/**
 * Validate the `conflictPolicy` config field against its literal union.
 *
 * @param policy Caller-supplied value (optional).
 * @returns The resolved policy.
 * @throws {GhDbError} when the value is outside the literal union.
 */
function validateConflictPolicy(policy: ConflictPolicy | undefined): ConflictPolicy {
  if (policy === undefined) return DEFAULT_CONFLICT_POLICY;
  if (policy !== 'fail' && policy !== 'retry' && policy !== 'rebase') {
    throw new GhDbError(
      'validation',
      `Invalid 'conflictPolicy': ${String(policy)}. Expected 'fail' | 'retry' | 'rebase'.`,
    );
  }
  return policy;
}

/**
 * Validate the `readConsistency` config field against its literal union.
 *
 * @param policy Caller-supplied value (optional).
 * @returns The resolved policy.
 * @throws {GhDbError} when the value is outside the literal union.
 */
function validateReadConsistency(
  policy: ReadConsistencyPolicy | undefined,
): ReadConsistencyPolicy {
  if (policy === undefined) return DEFAULT_READ_CONSISTENCY;
  if (policy !== 'fresh' && policy !== 'cached') {
    throw new GhDbError(
      'validation',
      `Invalid 'readConsistency': ${String(policy)}. Expected 'fresh' | 'cached'.`,
    );
  }
  return policy;
}

/**
 * Clamp a number into [`min`, `max`] (silently — clamping is by design,
 * not an error condition, per the spec).
 *
 * @param value Input number.
 * @param min Lower bound (inclusive).
 * @param max Upper bound (inclusive).
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return Math.floor(value);
}
