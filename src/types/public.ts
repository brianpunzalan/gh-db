/**
 * Any JSON-serializable value: primitives, arrays of JsonValue, or
 * plain objects whose property values are JsonValue. Excludes
 * `undefined`, functions, and `BigInt`.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Commit-conflict-resolution policy.
 *
 * - `'fail'`: abort on conflict, preserve staging.
 * - `'retry'`: refetch tip and replay staged batch (bounded).
 * - `'rebase'`: as `'retry'`, but abort if staged keys overlap external changes.
 */
export type ConflictPolicy = 'fail' | 'retry' | 'rebase';

/**
 * Read-freshness policy.
 *
 * - `'fresh'`: every `retrieve` refetches the tip first.
 * - `'cached'`: reads use the cached tip until commit/rollback/refresh.
 */
export type ReadConsistencyPolicy = 'fresh' | 'cached';

/** The three operation kinds a staged record may have. */
export type StagedOperationKind = 'create' | 'update' | 'delete';

/**
 * Configuration accepted by the {@link GhDb} constructor.
 */
export interface GhDbConfig {
  /** GitHub login of the owner (user or org). */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Working branch. Defaults to the repository's default branch. */
  branch?: string;
  /** GitHub API base URL. Defaults to `https://api.github.com`. */
  baseUrl?: string;
  /** GitHub personal access token. */
  auth: string;
  /** Conflict policy default (override per-commit via CommitOptions). */
  conflictPolicy?: ConflictPolicy;
  /** Max attempts for `retry` / `rebase` policy. Default 3, max 10. */
  conflictMaxAttempts?: number;
  /** Read-consistency mode. Default `'fresh'`. */
  readConsistency?: ReadConsistencyPolicy;
  /** Transient-error retry attempts. Default 3, max 10. */
  retryMaxAttempts?: number;
  /** Base delay (ms) for transient-error backoff. Default 500, max 5000. */
  retryBaseDelayMs?: number;
  /** Optional User-Agent header override. */
  userAgent?: string;
}

/** Per-commit options. */
export interface CommitOptions {
  /** Non-empty commit message. */
  message: string;
  /** Override the instance's default conflict policy for this commit. */
  conflictPolicy?: ConflictPolicy;
}

/** Result of a successful {@link GhDb.commit} call. */
export interface CommitResult {
  /** SHA of the new commit. */
  sha: string;
  /** SHA of the parent commit (the staging baseline). */
  parentSha: string;
  /** SHA of the tree object created for this commit. */
  treeSha: string;
  /** The branch whose tip now points at `sha`. */
  branch: string;
  /** Echoed commit message. */
  message: string;
}

/** A pending operation as reported by {@link GhDb.listStaged}. */
export interface StagedOperation {
  /** The operation kind. */
  kind: StagedOperationKind;
  /** The record key. */
  key: string;
  /** Present for `'create'` and `'update'`; absent for `'delete'`. */
  value?: JsonValue;
  /** Wall-clock time the operation was enqueued. */
  enqueuedAt: Date;
}

/** Repository creation input. */
export interface CreateRepositoryOptions {
  /** Repository name. */
  name: string;
  /** Visibility — `'public'` or `'private'`. */
  visibility: 'public' | 'private';
  /** Optional organization to create under (defaults to the authed user). */
  organization?: string;
  /** Optional description. */
  description?: string;
}

/** Repository creation output. */
export interface CreateRepositoryResult {
  /** Owner login (user or org). */
  owner: string;
  /** Repository name. */
  name: string;
  /** Default branch the new repo was initialized with. */
  defaultBranch: string;
  /** SHA of the auto-init commit. */
  initialCommitSha: string;
}

/** Webhook registration input. */
export interface WebhookSubscriptionOptions {
  /** Destination URL for delivered events. */
  callbackUrl: string;
  /** GitHub event types (e.g. `['push']`). */
  events: string[];
  /** Whether GitHub should deliver events (default `true`). */
  active?: boolean;
}

/** Webhook subscription as reported by gh-db. */
export interface WebhookSubscription {
  /** GitHub's hook id. */
  id: number;
  /** Configured callback URL. */
  callbackUrl: string;
  /** Configured event names. */
  events: string[];
  /** Whether GitHub will deliver events. */
  active: boolean;
  /** Last delivery status when surfaced by GitHub's API. */
  lastDeliveryStatus?: string;
}

/** Output of {@link GhDb.retrieve}. */
export type RetrieveResult = { found: true; value: JsonValue } | { found: false };

/**
 * Callback invoked by {@link GhDb.watch} on each poll that detects a change.
 *
 * - On success: `error` is `null` and `result` is the latest {@link RetrieveResult}.
 * - On error: `error` is the thrown {@link Error} and `result` is `undefined`.
 */
export type WatchCallback = (error: Error | null, result: RetrieveResult | undefined) => void;

/** Options for {@link GhDb.watch}. */
export interface WatchOptions {
  /** How often to poll GitHub in milliseconds. Default 5000. Minimum 1000. */
  intervalMs?: number;
}

/** Handle returned by {@link GhDb.watch} to stop the polling loop. */
export interface WatchHandle {
  /** Stop polling and release the interval. Further callbacks will not fire. */
  unsubscribe(): void;
}
