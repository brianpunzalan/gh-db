# Contract: Public TypeScript API

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

This document is the authoritative description of every symbol that
`gh-db` exports from its main entry point (`src/index.ts`). Each symbol
listed here MUST appear in the published package; symbols not listed
here MUST NOT be exported (the package's public surface is closed-world
for v1).

The contract is given as TypeScript signatures with JSDoc shells.
Implementations MUST match these signatures exactly; tests under
`tests/contract/public-api-shape.test.ts` enforce conformance.

---

## Module entry point: `gh-db`

```ts
// src/index.ts (authoritative public surface)

export { GhDb } from './core/gh-db';

export type {
  GhDbConfig,
  ConflictPolicy,
  ReadConsistencyPolicy,
  CommitOptions,
  CommitResult,
  StagedOperation,
  StagedOperationKind,
  CreateRepositoryOptions,
  CreateRepositoryResult,
  WebhookSubscriptionOptions,
  WebhookSubscription,
  JsonValue,
  RetrieveResult,
} from './types/public';

export {
  GhDbError,
  AuthError,
  PermissionError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RateLimitError,
  ServerError,
  NetworkError,
  ParseError,
  SerializationError,
  KeyValidationError,
  RetryExhaustedError,
  StagingError,
  RollbackError,
  GhDbErrorCode,
} from './errors';
```

---

## `class GhDb`

```ts
/**
 * Entry point for using a GitHub repository as a JSON datastore.
 *
 * One instance corresponds to one (owner, repo, branch, baseUrl, token)
 * tuple. The instance owns an in-memory staging area; staged changes
 * are visible only to this instance and never leave the host process
 * until a commit succeeds.
 */
export declare class GhDb {
  /**
   * Construct a new gh-db instance bound to a configured GitHub
   * repository.
   *
   * @param config The instance configuration. See {@link GhDbConfig}.
   * @throws {KeyValidationError} when the branch name is empty or
   *   syntactically invalid.
   * @throws {GhDbError} when `config` fails validation. Specific
   *   subclasses are documented per field on {@link GhDbConfig}.
   */
  constructor(config: GhDbConfig);

  // ── Repository provisioning ─────────────────────────────────

  /**
   * Create a new GitHub repository under the configured owner with the
   * given name and visibility. Returns a handle the caller can use
   * for subsequent operations (callers typically reconfigure this
   * instance or create a new one pointing at the returned repo).
   *
   * @param options See {@link CreateRepositoryOptions}.
   * @returns A {@link CreateRepositoryResult} containing the repo's
   *   `owner`, `name`, `defaultBranch`, and initial commit SHA.
   * @throws {ValidationError} when GitHub reports the requested name
   *   already exists for this owner. The error's `code` is
   *   `'already_exists'`.
   * @throws {PermissionError} when the configured token lacks the
   *   `repo` (or admin) scope required to create repositories.
   * @throws {AuthError} on token rejection.
   */
  createRepository(options: CreateRepositoryOptions): Promise<CreateRepositoryResult>;

  // ── CRUD (single-key staged operations) ─────────────────────

  /**
   * Stage the creation of a JSON record under `key`. The operation
   * enters the staging area but is NOT written to GitHub until
   * {@link GhDb.commit} is called.
   *
   * @param key Single flat segment (no `/`, no `\`, non-empty,
   *   no path-traversal). See FR-005a.
   * @param value Any JSON-serializable value.
   * @throws {KeyValidationError} when `key` is invalid.
   * @throws {SerializationError} when `value` is not JSON-serializable.
   * @throws {StagingError} when a record already exists at `key` in
   *   the committed state or in the staging area as a pending create
   *   / update.
   */
  stageCreate(key: string, value: JsonValue): Promise<void>;

  /**
   * Retrieve the deserialized JSON value stored under `key`. Reflects
   * any pending staged change for `key` ahead of the committed state.
   * For un-staged keys, resolves against the working branch tip per
   * the configured {@link ReadConsistencyPolicy}.
   *
   * @param key The record key.
   * @returns A {@link RetrieveResult} whose `found` flag is `false`
   *   when the key is absent (or staged for delete).
   * @throws {KeyValidationError} when `key` is invalid.
   * @throws {ParseError} when the stored content cannot be parsed
   *   as JSON.
   * @throws {NotFoundError} is NOT thrown — absence is reported via
   *   {@link RetrieveResult.found = false}.
   */
  retrieve(key: string): Promise<RetrieveResult>;

  /**
   * Stage an update of an existing JSON record under `key` with the
   * given value.
   *
   * @throws {KeyValidationError} when `key` is invalid.
   * @throws {SerializationError} when `value` is not JSON-serializable.
   * @throws {StagingError} when no record exists at `key` (either
   *   committed or staged as a pending create).
   */
  stageUpdate(key: string, value: JsonValue): Promise<void>;

  /**
   * Stage the deletion of the record under `key`.
   *
   * @throws {KeyValidationError} when `key` is invalid.
   * @throws {StagingError} when no record exists at `key`.
   */
  stageDelete(key: string): Promise<void>;

  // ── Staging inspection / reset ──────────────────────────────

  /**
   * Return a snapshot list of every pending Staged Operation in the
   * instance's staging area. The returned array is a shallow copy;
   * callers may mutate it freely without affecting gh-db.
   */
  listStaged(): StagedOperation[];

  /**
   * Discard all staged operations without contacting GitHub. The
   * repository state is unaffected. After reset, the staging area
   * is empty and the staging baseline is cleared.
   */
  reset(): void;

  // ── Commit ───────────────────────────────────────────────────

  /**
   * Apply all staged operations atomically as a single commit on the
   * working branch. On success, clears the staging area and updates
   * the cached tip.
   *
   * @param options Must include a non-empty `message`. May override
   *   the instance's default conflict policy per-commit.
   * @returns A {@link CommitResult} containing the new commit's SHA,
   *   parent SHA, tree SHA, branch, and message.
   * @throws {ValidationError} when `options.message` is empty or
   *   whitespace-only.
   * @throws {ConflictError} when commit fails due to a non-fast-forward
   *   ref update under `'fail'` policy, or under `'rebase'` policy
   *   when staged keys overlap external changes. The staging area is
   *   left intact.
   * @throws {RetryExhaustedError} when `'retry'` / `'rebase'` policy
   *   exhausts its attempt budget.
   * @throws {AuthError}, {PermissionError}, {RateLimitError},
   *   {ServerError}, {NetworkError} for the corresponding underlying
   *   GitHub failure categories.
   */
  commit(options: CommitOptions): Promise<CommitResult>;

  // ── Rollback ─────────────────────────────────────────────────

  /**
   * Force-update the working branch tip to the parent commit of the
   * current tip. Subsequent reads reflect the pre-rollback state.
   *
   * @throws {RollbackError} when the current tip has no parent
   *   (initial commit), or when the staging area is non-empty.
   * @throws {AuthError}, {PermissionError}, {RateLimitError},
   *   {ServerError}, {NetworkError} for the corresponding underlying
   *   GitHub failure categories.
   */
  rollback(): Promise<void>;

  // ── Read-consistency control ────────────────────────────────

  /**
   * Refresh the instance's cached working-branch tip without
   * performing a read. Useful under `readConsistency: 'cached'` after
   * receiving a webhook indicating the repository advanced.
   *
   * @returns The new cached tip SHA.
   */
  refresh(): Promise<string>;

  // ── Webhooks ─────────────────────────────────────────────────

  /**
   * Register a webhook on the configured repository.
   *
   * @param options See {@link WebhookSubscriptionOptions}.
   * @returns A {@link WebhookSubscription} containing GitHub's hook id.
   * @throws {ValidationError} when GitHub rejects the event list or
   *   the callback URL.
   */
  subscribeWebhook(options: WebhookSubscriptionOptions): Promise<WebhookSubscription>;

  /**
   * List all webhooks currently registered on the configured repository.
   * Returns subscriptions registered through gh-db AND any other source
   * (gh-db does not filter by who registered the hook).
   */
  listWebhooks(): Promise<WebhookSubscription[]>;

  /**
   * Remove a webhook from the configured repository by GitHub's hook id.
   *
   * @throws {NotFoundError} when no hook with that id exists on this
   *   repository.
   */
  unsubscribeWebhook(id: number): Promise<void>;
}
```

---

## Public types

```ts
// src/types/public.ts

/** Any JSON-serializable value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ConflictPolicy = 'fail' | 'retry' | 'rebase';
export type ReadConsistencyPolicy = 'fresh' | 'cached';
export type StagedOperationKind = 'create' | 'update' | 'delete';

/** Configuration accepted by the {@link GhDb} constructor. */
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
  /** Echoed message. */
  message: string;
}

/** A pending operation as reported by {@link GhDb.listStaged}. */
export interface StagedOperation {
  kind: StagedOperationKind;
  key: string;
  /** Present for `'create'` and `'update'`; absent for `'delete'`. */
  value?: JsonValue;
  enqueuedAt: Date;
}

/** Repository creation input. */
export interface CreateRepositoryOptions {
  name: string;
  visibility: 'public' | 'private';
  /** Optional organization to create under (defaults to the authed user). */
  organization?: string;
  /** Optional description. */
  description?: string;
}

/** Repository creation output. */
export interface CreateRepositoryResult {
  owner: string;
  name: string;
  defaultBranch: string;
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
  id: number;
  callbackUrl: string;
  events: string[];
  active: boolean;
  lastDeliveryStatus?: string;
}

/** Output of {@link GhDb.retrieve}. */
export type RetrieveResult =
  | { found: true; value: JsonValue }
  | { found: false };
```

---

## Method-call contracts (operational)

For each method, what the contract guarantees about staging area state
and network side-effects:

| Method | Network calls (success path) | Staging area side effects | Cached tip side effects |
|---|---|---|---|
| constructor | 0 (defers initial tip fetch) | empty | unset |
| `createRepository` | POST `/user/repos` or `/orgs/{org}/repos` | unchanged | unchanged |
| `stageCreate` | 0 (unless reading committed state to validate "doesn't already exist") | grows by 1 (or collapses) | unchanged |
| `retrieve` | under `fresh`: GET ref + (optional) GET blob; under `cached`: GET blob only | unchanged | refreshed under `fresh` only |
| `stageUpdate` | 0 (unless validating "exists") | grows by 1 (or collapses) | unchanged |
| `stageDelete` | 0 | grows by 1 (or collapses) | unchanged |
| `listStaged` | 0 | unchanged | unchanged |
| `reset` | 0 | cleared | unchanged |
| `commit` | full pipeline (blobs → tree → commit → ref) | cleared on success; intact on failure | updated on success |
| `rollback` | GET commit + PATCH ref | refuses if non-empty | updated on success |
| `refresh` | GET ref | unchanged | refreshed |
| `subscribeWebhook` | POST `/repos/{owner}/{repo}/hooks` | unchanged | unchanged |
| `listWebhooks` | GET `/repos/{owner}/{repo}/hooks` | unchanged | unchanged |
| `unsubscribeWebhook` | DELETE `/repos/{owner}/{repo}/hooks/{id}` | unchanged | unchanged |

Note on staging validation calls: a `stageCreate` / `stageUpdate` /
`stageDelete` may need to know whether a record exists in the
committed state. The implementation MAY defer that check to commit
time (FR-005 covers semantics; gh-db is free to validate eagerly or
lazily as long as the StagingError contract is honored). The
recommended approach is lazy validation against the cached tip's
tree to avoid extra round-trips on every staging call; a documented
trade-off in the README will inform callers.
