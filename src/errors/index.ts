/**
 * Discriminated literal union of every gh-db error code. Useful for
 * exhaustive `switch (err.code)` branching when `instanceof` is
 * inconvenient.
 */
export type GhDbErrorCode =
  | 'auth'
  | 'permission'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'parse'
  | 'serialization'
  | 'key_validation'
  | 'retry_exhausted'
  | 'staging'
  | 'rollback';

/** Constructor options shared by every gh-db error subclass. */
interface GhDbErrorOptions {
  /** Underlying cause (HTTP error, parse error, etc.). */
  cause?: unknown;
}

/**
 * Base class for every error surfaced by gh-db. All gh-db errors are
 * instances of GhDbError; a non-GhDbError throw indicates a bug in
 * gh-db.
 */
export class GhDbError extends Error {
  /** Discriminator for narrowing on `error.code`. */
  public readonly code: GhDbErrorCode;
  /** Optional underlying cause (HTTP error, parse error, etc.). */
  public override readonly cause?: unknown;

  /**
   * @param code Discriminating literal code.
   * @param message Human-readable message.
   * @param options Optional cause carrier.
   */
  public constructor(code: GhDbErrorCode, message: string, options?: GhDbErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** HTTP 401 from GitHub: token rejected. */
export class AuthError extends GhDbError {
  public override readonly code: 'auth' = 'auth' as const;

  /**
   * @param message Human-readable message.
   * @param options Optional cause carrier.
   */
  public constructor(message: string, options?: GhDbErrorOptions) {
    super('auth', message, options);
  }
}

/** Options accepted by {@link PermissionError}. */
interface PermissionErrorOptions extends GhDbErrorOptions {
  /** Optional scope hint extracted from the response body. */
  requiredScope?: string;
}

/**
 * HTTP 403 from GitHub WITHOUT a rate-limit indicator: token lacks the
 * required scope for the requested operation.
 */
export class PermissionError extends GhDbError {
  public override readonly code: 'permission' = 'permission' as const;
  /** Optional scope hint extracted from the response body. */
  public readonly requiredScope?: string;

  /**
   * @param message Human-readable message.
   * @param options Optional scope hint + cause carrier.
   */
  public constructor(message: string, options?: PermissionErrorOptions) {
    super('permission', message, options);
    if (options?.requiredScope !== undefined) {
      this.requiredScope = options.requiredScope;
    }
  }
}

/** Kind of resource that was not found in a {@link NotFoundError}. */
export type NotFoundResourceKind = 'repo' | 'branch' | 'key' | 'hook' | 'commit';

/** Options accepted by {@link NotFoundError}. */
interface NotFoundErrorOptions extends GhDbErrorOptions {
  /** What kind of resource was missing. */
  resourceKind: NotFoundResourceKind;
}

/** HTTP 404 from GitHub: target resource not present. */
export class NotFoundError extends GhDbError {
  public override readonly code: 'not_found' = 'not_found' as const;
  /** What kind of resource was missing. */
  public readonly resourceKind: NotFoundResourceKind;

  /**
   * @param message Human-readable message.
   * @param options Includes the resource kind that was missing.
   */
  public constructor(message: string, options: NotFoundErrorOptions) {
    super('not_found', message, options);
    this.resourceKind = options.resourceKind;
  }
}

/** Subcode for {@link ValidationError} specializations. */
export type ValidationSubcode = 'already_exists' | 'invalid_input' | 'invalid_event';

/** Options accepted by {@link ValidationError}. */
interface ValidationErrorOptions extends GhDbErrorOptions {
  /** Subcode for specialized cases. */
  subcode?: ValidationSubcode;
}

/** HTTP 422 from GitHub (validation), excluding commit-pipeline conflicts. */
export class ValidationError extends GhDbError {
  public override readonly code: 'validation' = 'validation' as const;
  /** Subcode for specialized cases (e.g. 'already_exists' on repo create). */
  public readonly subcode?: ValidationSubcode;

  /**
   * @param message Human-readable message.
   * @param options Optional subcode + cause carrier.
   */
  public constructor(message: string, options?: ValidationErrorOptions) {
    super('validation', message, options);
    if (options?.subcode !== undefined) {
      this.subcode = options.subcode;
    }
  }
}

/** Options accepted by {@link ConflictError}. */
interface ConflictErrorOptions extends GhDbErrorOptions {
  /** Baseline commit SHA at the moment staging began. */
  baselineSha: string;
  /** Remote tip SHA observed when the commit was attempted. */
  remoteSha: string;
  /** Populated only under `rebase` policy when keys overlap. */
  overlappingKeys?: string[];
}

/** Commit conflict: either `fail` policy or `rebase`-overlap outcome. */
export class ConflictError extends GhDbError {
  public override readonly code: 'conflict' = 'conflict' as const;
  /** Baseline commit SHA at the moment staging began. */
  public readonly baselineSha: string;
  /** Remote tip SHA observed when the commit was attempted. */
  public readonly remoteSha: string;
  /** Populated only under `rebase` policy when keys overlap. */
  public readonly overlappingKeys?: string[];

  /**
   * @param message Human-readable message.
   * @param options Baseline/remote SHAs and optional overlap list.
   */
  public constructor(message: string, options: ConflictErrorOptions) {
    super('conflict', message, options);
    this.baselineSha = options.baselineSha;
    this.remoteSha = options.remoteSha;
    if (options.overlappingKeys !== undefined) {
      this.overlappingKeys = options.overlappingKeys;
    }
  }
}

/** Kind of rate-limit hit (`'primary'` 429 or `'secondary'` 403). */
export type RateLimitKind = 'primary' | 'secondary';

/** Options accepted by {@link RateLimitError}. */
interface RateLimitErrorOptions extends GhDbErrorOptions {
  /** Wall-clock time when GitHub indicates the limit resets, if known. */
  resetAt?: Date;
  /** Either 'primary' (429) or 'secondary' (403 with rate-limit header). */
  kind: RateLimitKind;
}

/** HTTP 429 primary or 403 secondary rate limit. */
export class RateLimitError extends GhDbError {
  public override readonly code: 'rate_limit' = 'rate_limit' as const;
  /** Wall-clock time when GitHub indicates the limit resets, if known. */
  public readonly resetAt?: Date;
  /** Either 'primary' (429) or 'secondary' (403 with rate-limit header). */
  public readonly kind: RateLimitKind;

  /**
   * @param message Human-readable message.
   * @param options Reset hint + rate-limit kind.
   */
  public constructor(message: string, options: RateLimitErrorOptions) {
    super('rate_limit', message, options);
    this.kind = options.kind;
    if (options.resetAt !== undefined) {
      this.resetAt = options.resetAt;
    }
  }
}

/** Options accepted by {@link ServerError}. */
interface ServerErrorOptions extends GhDbErrorOptions {
  /** HTTP status code (5xx). */
  status: number;
}

/** HTTP 5xx from GitHub: server-side error. */
export class ServerError extends GhDbError {
  public override readonly code: 'server' = 'server' as const;
  /** HTTP status code (5xx). */
  public readonly status: number;

  /**
   * @param message Human-readable message.
   * @param options Carries the failing HTTP status.
   */
  public constructor(message: string, options: ServerErrorOptions) {
    super('server', message, options);
    this.status = options.status;
  }
}

/** Transport-level failure: no HTTP response received. */
export class NetworkError extends GhDbError {
  public override readonly code: 'network' = 'network' as const;

  /**
   * @param message Human-readable message.
   * @param options Optional cause carrier.
   */
  public constructor(message: string, options?: GhDbErrorOptions) {
    super('network', message, options);
  }
}

/** Options accepted by {@link ParseError}. */
interface ParseErrorOptions extends GhDbErrorOptions {
  /** The record key whose content failed to parse. */
  key: string;
  /** Size of the offending content in bytes (no content body). */
  contentSizeBytes: number;
}

/** JSON parse failure on retrieve. */
export class ParseError extends GhDbError {
  public override readonly code: 'parse' = 'parse' as const;
  /** The record key whose content failed to parse. */
  public readonly key: string;
  /** Size of the offending content in bytes (no content body). */
  public readonly contentSizeBytes: number;

  /**
   * @param message Human-readable message.
   * @param options Includes `key` and `contentSizeBytes`.
   */
  public constructor(message: string, options: ParseErrorOptions) {
    super('parse', message, options);
    this.key = options.key;
    this.contentSizeBytes = options.contentSizeBytes;
  }
}

/** Reason a value could not be JSON-encoded. */
export type SerializationReason = 'circular' | 'unsupported_type' | 'undefined_top_level';

/** Options accepted by {@link SerializationError}. */
interface SerializationErrorOptions extends GhDbErrorOptions {
  /** The record key being staged. */
  key: string;
  /** Why the value could not be encoded. */
  reason: SerializationReason;
}

/** Write-side: caller value not JSON-serializable. */
export class SerializationError extends GhDbError {
  public override readonly code: 'serialization' = 'serialization' as const;
  /** The record key being staged. */
  public readonly key: string;
  /** Why the value could not be encoded. */
  public readonly reason: SerializationReason;

  /**
   * @param message Human-readable message.
   * @param options Includes `key` and `reason`.
   */
  public constructor(message: string, options: SerializationErrorOptions) {
    super('serialization', message, options);
    this.key = options.key;
    this.reason = options.reason;
  }
}

/** Options accepted by {@link KeyValidationError}. */
interface KeyValidationErrorOptions extends GhDbErrorOptions {
  /** The offending key string. */
  key: string;
}

/** Key fails format validation (FR-005a). */
export class KeyValidationError extends GhDbError {
  public override readonly code: 'key_validation' = 'key_validation' as const;
  /** The offending key string. */
  public readonly key: string;

  /**
   * @param message Human-readable message.
   * @param options Carries the offending key.
   */
  public constructor(message: string, options: KeyValidationErrorOptions) {
    super('key_validation', message, options);
    this.key = options.key;
  }
}

/** Category of transient error that led to retry exhaustion. */
export type RetryExhaustedUnderlying = 'rate_limit' | 'server' | 'network';

/** Options accepted by {@link RetryExhaustedError}. */
interface RetryExhaustedErrorOptions extends GhDbErrorOptions {
  /** Category of transient error that exhausted the budget. */
  underlying: RetryExhaustedUnderlying;
  /** Number of attempts made before giving up. */
  attempts: number;
  /** Optional reset hint from the last response (rate limits). */
  resetAt?: Date;
}

/** Transient-error retry budget exhausted (FR-030). */
export class RetryExhaustedError extends GhDbError {
  public override readonly code: 'retry_exhausted' = 'retry_exhausted' as const;
  /** Category of transient error that exhausted the budget. */
  public readonly underlying: RetryExhaustedUnderlying;
  /** Number of attempts made before giving up. */
  public readonly attempts: number;
  /** Optional reset hint from the last response (rate limits). */
  public readonly resetAt?: Date;

  /**
   * @param message Human-readable message.
   * @param options Underlying category, attempt count, optional reset.
   */
  public constructor(message: string, options: RetryExhaustedErrorOptions) {
    super('retry_exhausted', message, options);
    this.underlying = options.underlying;
    this.attempts = options.attempts;
    if (options.resetAt !== undefined) {
      this.resetAt = options.resetAt;
    }
  }
}

/** Logical staging-area violation kind. */
export type StagingViolation = 'create_on_existing' | 'update_on_missing' | 'delete_on_missing';

/** Options accepted by {@link StagingError}. */
interface StagingErrorOptions extends GhDbErrorOptions {
  /** The key the operation targeted. */
  key: string;
  /** Specific staging-rule violation. */
  violation: StagingViolation;
}

/** Pre-staging logical violation (e.g., create on existing key). */
export class StagingError extends GhDbError {
  public override readonly code: 'staging' = 'staging' as const;
  /** The key the operation targeted. */
  public readonly key: string;
  /** Specific staging-rule violation. */
  public readonly violation: StagingViolation;

  /**
   * @param message Human-readable message.
   * @param options Includes `key` and `violation`.
   */
  public constructor(message: string, options: StagingErrorOptions) {
    super('staging', message, options);
    this.key = options.key;
    this.violation = options.violation;
  }
}

/** Reason a rollback was refused. */
export type RollbackReason = 'initial_commit' | 'staging_not_empty';

/** Options accepted by {@link RollbackError}. */
interface RollbackErrorOptions extends GhDbErrorOptions {
  /** Why the rollback was refused. */
  reason: RollbackReason;
}

/** Rollback refused — either at initial commit or with pending stage. */
export class RollbackError extends GhDbError {
  public override readonly code: 'rollback' = 'rollback' as const;
  /** Why the rollback was refused. */
  public readonly reason: RollbackReason;

  /**
   * @param message Human-readable message.
   * @param options Includes the refusal reason.
   */
  public constructor(message: string, options: RollbackErrorOptions) {
    super('rollback', message, options);
    this.reason = options.reason;
  }
}
