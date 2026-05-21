# Contract: Typed Error Hierarchy

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

`gh-db` surfaces every distinct failure category as a programmatically
distinguishable error class, all rooted at a single base class
`GhDbError`. Callers may either `instanceof`-check against the
specific subclass or `switch` on `error.code` (a discriminated literal
union). This contract is authoritative; SC-006's "error-coverage matrix"
is the test artifact derived from it.

---

## Base class

```ts
/** Discriminated literal union of every gh-db error code. */
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

/**
 * Base class for every error surfaced by gh-db. All gh-db errors are
 * instances of GhDbError; a non-GhDbError throw is a bug in gh-db.
 */
export declare class GhDbError extends Error {
  /** Discriminator for narrowing. */
  readonly code: GhDbErrorCode;
  /** Optional underlying cause (HTTP error, parse error, etc). */
  readonly cause?: unknown;
}
```

---

## Subclasses

Each subclass binds `code` to a single literal so TypeScript can
narrow on the union.

```ts
/** HTTP 401 from GitHub: token rejected. */
export declare class AuthError extends GhDbError {
  readonly code: 'auth';
}

/** HTTP 403 from GitHub WITHOUT a rate-limit indicator: insufficient scope. */
export declare class PermissionError extends GhDbError {
  readonly code: 'permission';
  /** Optional scope hint extracted from the response body. */
  readonly requiredScope?: string;
}

/** HTTP 404 from GitHub: target resource not present. */
export declare class NotFoundError extends GhDbError {
  readonly code: 'not_found';
  /** What kind of resource was missing (`repo`, `branch`, `key`, `hook`). */
  readonly resourceKind: 'repo' | 'branch' | 'key' | 'hook' | 'commit';
}

/** HTTP 422 from GitHub (validation), excluding commit-pipeline conflicts. */
export declare class ValidationError extends GhDbError {
  readonly code: 'validation';
  /** Subcode for specialized cases (e.g. 'already_exists' on repo create). */
  readonly subcode?: 'already_exists' | 'invalid_input' | 'invalid_event';
}

/** Commit conflict: either `fail` policy or `rebase`-overlap. */
export declare class ConflictError extends GhDbError {
  readonly code: 'conflict';
  readonly baselineSha: string;
  readonly remoteSha: string;
  /** Populated only under `rebase` policy when keys overlap. */
  readonly overlappingKeys?: string[];
}

/** HTTP 429 primary OR 403 secondary rate limit. */
export declare class RateLimitError extends GhDbError {
  readonly code: 'rate_limit';
  /** Wall-clock time when GitHub indicates the limit resets, if known. */
  readonly resetAt?: Date;
  /** Either 'primary' (429) or 'secondary' (403 with rate-limit header). */
  readonly kind: 'primary' | 'secondary';
}

/** HTTP 5xx from GitHub: server error. */
export declare class ServerError extends GhDbError {
  readonly code: 'server';
  readonly status: number;
}

/** Transport-level failure: no HTTP response received. */
export declare class NetworkError extends GhDbError {
  readonly code: 'network';
}

/** JSON parse failure on retrieve. */
export declare class ParseError extends GhDbError {
  readonly code: 'parse';
  readonly key: string;
  readonly contentSizeBytes: number;
}

/** Write-side: caller value not JSON-serializable. */
export declare class SerializationError extends GhDbError {
  readonly code: 'serialization';
  readonly key: string;
  readonly reason: 'circular' | 'unsupported_type' | 'undefined_top_level';
}

/** Key fails format validation (FR-005a). */
export declare class KeyValidationError extends GhDbError {
  readonly code: 'key_validation';
  readonly key: string;
}

/** Transient-error retry budget exhausted (FR-030). */
export declare class RetryExhaustedError extends GhDbError {
  readonly code: 'retry_exhausted';
  readonly underlying: 'rate_limit' | 'server' | 'network';
  readonly attempts: number;
  readonly resetAt?: Date;
}

/** Pre-staging logical violation (e.g. create on existing key). */
export declare class StagingError extends GhDbError {
  readonly code: 'staging';
  readonly key: string;
  readonly violation:
    | 'create_on_existing'
    | 'update_on_missing'
    | 'delete_on_missing';
}

/** Rollback refused. */
export declare class RollbackError extends GhDbError {
  readonly code: 'rollback';
  readonly reason: 'initial_commit' | 'staging_not_empty';
}
```

---

## Mapping from GitHub HTTP responses

The retry / classification layer in `src/retry/classify.ts` MUST map
GitHub responses according to this table. Tests under
`tests/unit/retry/classify.test.ts` MUST exercise every row.

| HTTP status | Response indicator | gh-db error | Retried? |
|---|---|---|---|
| 401 | any | `AuthError` | no |
| 403 | `x-ratelimit-remaining: 0` | `RateLimitError` (`secondary`) | yes (transient) |
| 403 | no rate-limit indicator | `PermissionError` | no |
| 404 | any | `NotFoundError` | no |
| 422 | repository create, "name already exists" | `ValidationError` (`already_exists`) | no |
| 422 | webhook create, invalid event | `ValidationError` (`invalid_event`) | no |
| 422 | ref update (commit pipeline), not fast-forward | `ConflictError` | no (conflict policy handles) |
| 422 | other | `ValidationError` (`invalid_input`) | no |
| 429 | any | `RateLimitError` (`primary`) | yes (transient) |
| 5xx | any | `ServerError` | yes (transient) |
| (no response) | network error | `NetworkError` | yes (transient) |
| n/a | JSON.parse throws on retrieve | `ParseError` | no |
| n/a | JSON.stringify throws on stage* | `SerializationError` | no |
| n/a | invalid key | `KeyValidationError` | no |
| n/a | bounded retry exhausted | `RetryExhaustedError` | no (terminal) |
| n/a | staging-area logical violation | `StagingError` | no |
| n/a | rollback refusal | `RollbackError` | no |
