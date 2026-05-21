# Phase 1 Data Model: gh-db

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

This document defines the entities, their fields, relationships, and
state transitions that gh-db maintains in memory and reads from / writes
to GitHub. Because gh-db is a library (not a service), most "data" lives
either in the GitHub repository (the durable store) or in the in-memory
per-instance staging area.

---

## Entity 1 — Repository Handle

The configured target of a `GhDb` instance. Created at instantiation;
immutable for the lifetime of the instance.

| Field | Type | Description | Source |
|---|---|---|---|
| `owner` | `string` | GitHub login of the repository owner (user or org). Required. | Caller config |
| `repo` | `string` | Repository name. Required. | Caller config |
| `branch` | `string` | Working branch name. Defaults to the repository's GitHub-reported default branch (typically `main`). | Caller config or fetched from GitHub on first use |
| `baseUrl` | `string` (URL) | GitHub API base URL. Defaults to `https://api.github.com`. Caller-supplied for GHES / GHEC custom domains. | Caller config |
| `auth` | `string` (opaque) | GitHub personal access token. Never logged or echoed. | Caller config |

**Validation**:

- `owner` and `repo`: non-empty strings, no whitespace, no `/`.
- `branch`: non-empty string, follows
  [Git reference naming rules](https://git-scm.com/docs/git-check-ref-format)
  (gh-db rejects empty/whitespace and obvious offenders; GitHub itself
  is the ultimate validator).
- `baseUrl`: parseable as a URL with `https` (or `http` for self-signed
  test environments).
- `auth`: non-empty; otherwise opaque.

**Relationships**:

- One Repository Handle per `GhDb` instance.
- The handle is the target of all CRUD, commit, rollback, repository
  provisioning, and webhook operations.

---

## Entity 2 — JSON Record

A single addressable JSON document stored at the top level of the
repository's working branch.

| Field | Type | Description |
|---|---|---|
| `key` | `string` | Caller-facing identifier. Single flat segment — no slash, no backslash, no path-traversal sequences. Required. |
| `value` | `JsonValue` | The deserialized JSON content. One of: `object`, `array`, `string`, `number`, `boolean`, or `null`. |

**Validation rules**:

- `key` must match `^[^/\\]+$` AND must not be exactly `.` or `..` AND
  must not contain control characters (FR-005a).
- `value` must be JSON-serializable: no functions, no circular
  references, no `undefined` at the top level, no `BigInt` (FR-009).
  Validation is performed by attempting `JSON.stringify(value)` and
  catching the throw, plus an explicit check that the result is not
  `undefined`.

**On-repository representation** (internal to gh-db, per FR-005b):

- Persisted as the file `${key}.json` at the root of the working
  branch, encoded as UTF-8 with content produced by
  `JSON.stringify(value, null, 2)`.

**Relationships**:

- A record belongs to a Repository Handle (its repo + branch).
- A record may have a corresponding Staged Operation in the active
  staging session for its `GhDb` instance.

**State transitions**:

```text
absent ──[stageCreate]──▶ staged-create ──[commit]──▶ present
present ──[stageUpdate]──▶ staged-update ──[commit]──▶ present (new value)
present ──[stageDelete]──▶ staged-delete ──[commit]──▶ absent
staged-create + stageDelete ──[collapse]──▶ absent (no commit entry)
staged-update + stageUpdate ──[collapse]──▶ staged-update (last value wins)
staged-create + stageUpdate ──[collapse]──▶ staged-create (with last value)
any staged-* ──[reset]──▶ (unstaged, repo state unchanged)
```

---

## Entity 3 — Staged Operation

A pending change to a JSON record. Lives only in the in-memory staging
area of one `GhDb` instance.

| Field | Type | Description |
|---|---|---|
| `kind` | `'create' \| 'update' \| 'delete'` | The operation type. |
| `key` | `string` | The target record's key. |
| `value` | `JsonValue \| undefined` | Present for `create` and `update`; absent for `delete`. |
| `enqueuedAt` | `Date` | Wall-clock time the op was enqueued (for inspection / observability). |

**Validation**:

- `kind === 'create'` requires that no record currently exists at
  `key` *in the committed state OR in the staging area as a pending
  create/update*. Violation → `StagingError` (FR-005 + edge case).
- `kind === 'update'` requires that a record currently exists at
  `key` in the committed state OR in the staging area as a pending
  create. Violation → `StagingError`.
- `kind === 'delete'` requires that a record currently exists at
  `key` in the committed state OR in the staging area as a pending
  create. Violation → `StagingError`.
- `value` is JSON-validated (per Entity 2 rules) before the operation
  is enqueued.

**Relationships**:

- Belongs to a single Staging Area (Entity 4).
- Targets exactly one JSON Record (by `key`).

**Collapse rules** (applied at commit time, FR-016):

| Existing | New op | Result |
|---|---|---|
| (none) | `create` | `create` |
| (none) | `update` | (rejected up front by validation) |
| (none) | `delete` | (rejected up front by validation) |
| `create` | `create` | (rejected up front by validation) |
| `create` | `update` | `create` (with the update's value) |
| `create` | `delete` | (removed — cancels out) |
| `update` | `create` | (rejected up front by validation) |
| `update` | `update` | `update` (with the latest value) |
| `update` | `delete` | `delete` |
| `delete` | `create` | `update` (with the create's value) |
| `delete` | `update` | (rejected up front by validation) |
| `delete` | `delete` | (rejected up front by validation) |

---

## Entity 4 — Staging Area

The in-memory, per-instance set of Staged Operations. Owned by exactly
one `GhDb` instance.

| Field | Type | Description |
|---|---|---|
| `operations` | `Map<string, StagedOperation>` | Keyed by record `key`. Map (not array) so collapse is O(1). |
| `baselineSha` | `string \| undefined` | The commit SHA of the working branch tip when the *first* staged op of the current session was enqueued. `undefined` when the staging area is empty. |
| `baselineTreeSha` | `string \| undefined` | Tree SHA reachable from `baselineSha`; cached to avoid an extra round-trip during commit. |

**Validation**:

- `baselineSha` MUST be set whenever `operations` is non-empty.
- `baselineSha` MUST be cleared (along with `baselineTreeSha`) when the
  staging area becomes empty.

**Relationships**:

- 1:1 with a `GhDb` instance.
- Holds 0..N Staged Operations.

**State transitions**:

```text
empty ──[stageCreate/stageUpdate/stageDelete]──▶ non-empty
                                                 (baselineSha captured)
non-empty ──[reset]──▶ empty (baselineSha cleared, no network)
non-empty ──[commit success]──▶ empty (baselineSha cleared)
non-empty ──[commit failure]──▶ non-empty (baselineSha intact; FR-013)
non-empty ──[stageX]──▶ non-empty (collapse may shrink it)
```

---

## Entity 5 — Commit

A single durable revision of the repository's state, produced by
applying all Staged Operations of one commit call.

| Field | Type | Description |
|---|---|---|
| `sha` | `string` | The GitHub commit SHA returned by the create-commit API call. |
| `parentSha` | `string` | The SHA of the parent commit (the staging baseline at commit time). |
| `treeSha` | `string` | The SHA of the tree object built from the staged batch. |
| `message` | `string` | The caller-supplied commit message (non-empty per FR-014). |
| `branch` | `string` | The branch whose tip now points at `sha`. |

**Validation**:

- `message` must be non-empty (FR-014). Whitespace-only messages are
  treated as empty.

**Relationships**:

- Produced by exactly one successful `commit()` call.
- Belongs to one Repository Handle.
- The unit of `rollback`.

---

## Entity 6 — Webhook Subscription

A GitHub-side registration created via gh-db's `subscribeWebhook`. gh-db
does not persist webhook records locally; the GitHub Webhooks API is
the source of truth, and gh-db wraps thin read/write calls.

| Field | Type | Description |
|---|---|---|
| `id` | `number` | GitHub's hook identifier. Used for unsubscribe. |
| `callbackUrl` | `string` (URL) | Destination URL for delivered events. |
| `events` | `string[]` | GitHub event-type identifiers (e.g. `'push'`, `'pull_request'`). Non-empty. |
| `active` | `boolean` | Whether GitHub will deliver events (defaults to `true` on create). |
| `lastDeliveryStatus` | `string \| undefined` | Status of the most recent delivery attempt, where surfaced by GitHub's API (for observability per Story 5 acceptance scenario 4). |

**Validation**:

- `callbackUrl` must be `http://` or `https://` and parseable as a URL.
- `events` must be a non-empty array of non-empty strings.

**Relationships**:

- Belongs to one Repository Handle.

---

## Entity 7 — Instance Configuration

The full, validated configuration of a `GhDb` instance. Computed by
parsing the caller-supplied config object at construction time.

| Field | Type | Description |
|---|---|---|
| `repository` | `RepositoryHandle` | (Entity 1) |
| `conflictPolicy` | `'fail' \| 'retry' \| 'rebase'` | Default `'fail'` (FR-022a). |
| `conflictMaxAttempts` | `number` | Bound for `retry` / `rebase` policies. Default `3`, hard upper limit `10`. |
| `readConsistency` | `'fresh' \| 'cached'` | Default `'fresh'` (FR-017a). |
| `retryMaxAttempts` | `number` | Bound for transient-error retries. Default `3`, hard upper limit `10` (FR-028). |
| `retryBaseDelayMs` | `number` | Base for exponential backoff. Default `500`, hard upper limit `5000` (FR-028). |
| `userAgent` | `string` | `User-Agent` header sent to GitHub. Defaults to `gh-db/<package-version>`. |

**Validation**:

- Each numeric bound is clamped into its documented range with a
  warning surfaced via the `onConfigWarning` callback (if provided)
  or the package's default logger.
- `conflictPolicy` and `readConsistency` are validated against their
  literal unions.

**Relationships**:

- 1:1 with a `GhDb` instance.
- Immutable after construction (caller may override `conflictPolicy`
  per-call on `commit`, but the instance default remains).

---

## Entity 8 — Cached Tip

The instance's last-observed working-branch tip SHA. Used by both the
read-consistency policy (Entity 7) and the staging baseline capture
(Entity 4).

| Field | Type | Description |
|---|---|---|
| `sha` | `string \| undefined` | Most recently observed tip. `undefined` until first read or commit. |
| `treeSha` | `string \| undefined` | Tree SHA reachable from `sha`, cached to skip a follow-up fetch on the commit pipeline. |
| `observedAt` | `Date \| undefined` | Wall-clock time the tip was last refreshed. |

**State transitions**:

```text
undefined ──[any operation that needs the tip]──▶ defined
defined ──[commit success]──▶ defined (updated to new commit SHA)
defined ──[rollback success]──▶ defined (updated to parent SHA)
defined ──[refresh()]──▶ defined (re-fetched)
defined ──[retrieve under 'fresh']──▶ defined (re-fetched)
defined ──[retrieve under 'cached']──▶ defined (unchanged)
```

---

## Cross-entity invariants

1. **Staging consistency**: If `operations` is non-empty, both
   `baselineSha` and `baselineTreeSha` are defined.
2. **Staging-vs-repo distinction**: Staged operations never reach
   GitHub except via a successful commit. No GitHub API call writes
   on behalf of an `enqueue` action (FR-010).
3. **Commit atomicity**: A `commit()` either produces one new Commit
   (Entity 5) and clears the Staging Area, or it produces no Commit
   and leaves the Staging Area exactly as it was (FR-013 / FR-022b).
4. **Rollback prerequisites**: `rollback()` requires the Staging Area
   to be empty (FR-020) and the current tip to have at least one parent
   (FR-019).
5. **Read freshness**: Under `readConsistency: 'fresh'`, every
   `retrieve()` refreshes the Cached Tip before resolving the read.
   Under `'cached'`, the Cached Tip is only refreshed on commit /
   rollback / `refresh()` (FR-017a/b).
6. **Read-through-staging**: For any key `K` with a Staged Operation
   in the Staging Area, `retrieve(K)` reflects the staged value (or
   "not found" for a staged delete) — never the committed value
   (FR-017).
7. **Conflict semantics**: A commit's success implies that the
   repository tip at write time was exactly `baselineSha`. Any other
   outcome surfaces a typed `ConflictError` (R-004).
