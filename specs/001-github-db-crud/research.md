# Phase 0 Research: gh-db

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21
**Status**: Complete — all NEEDS CLARIFICATION items resolved

This document records each technical decision made while turning the
clarification-complete spec into a concrete implementation plan. Each
decision lists the choice, the rationale, and the alternatives that were
considered and rejected.

---

## R-001: GitHub API client library

**Decision**: Use `@octokit/rest` (Octokit's typed REST client) as the sole
GitHub HTTP client, instantiated per gh-db instance with `auth`, `baseUrl`,
and `userAgent` options.

**Rationale**:

- It is the official GitHub-maintained SDK and tracks API changes closely.
- It accepts a `baseUrl` option, satisfying FR-002a (GitHub Enterprise Server
  / Enterprise Cloud with a custom domain) without any custom transport code.
- It exposes typed responses for the endpoints gh-db depends on (Git Data
  API: blobs / trees / commits / refs; Repository Contents API; Webhooks;
  Repository creation).
- It surfaces structured errors via `@octokit/request-error` (status,
  response headers, response body) so retry classification (FR-027) and
  `Retry-After` honoring (FR-028) can read the headers directly.
- Octokit's request hooks (`octokit.hook.before`, `octokit.hook.error`,
  `octokit.hook.wrap`) are the natural seam for inserting the
  exponential-backoff retry loop without re-implementing transport.

**Alternatives considered**:

- **Raw `fetch`**: Lower dependency footprint but forces gh-db to
  reimplement pagination, error shaping, auth-header construction, and
  base-URL composition — none of which add value, all of which are
  well-tested in Octokit.
- **`@octokit/core` + selectively-imported plugins**: Slightly smaller
  bundle but produces an awkward API surface for endpoints we use
  frequently (Git Data API). The bundle-size delta is negligible for a
  Node-only library, so the ergonomic win of `@octokit/rest` dominates.
- **`axios`** or **`undici`** directly: Adds a transport choice without
  solving the GitHub-specific concerns (auth, base URL, error shape).

---

## R-002: Atomic multi-file commit strategy

**Decision**: Implement commit as a four-step Git Data API pipeline:

1. **Read baseline tip**: Fetch the current branch ref to capture
   `baselineSha` and the tree SHA reachable from it. This is the
   *staging baseline* used by FR-022 / FR-022a.
2. **Create blobs**: For each staged create/update, POST
   `/repos/{owner}/{repo}/git/blobs` with the JSON-encoded content
   (UTF-8). Collect the returned blob SHAs.
3. **Create tree**: POST `/repos/{owner}/{repo}/git/trees` with
   `base_tree=<baselineTreeSha>` plus a `tree` array entry per staged
   key (create/update entries with `sha=<blobSha>`, delete entries with
   `sha=null` to remove).
4. **Create commit**: POST `/repos/{owner}/{repo}/git/commits` with the
   new tree SHA, the caller's commit message, and `parents=[baselineSha]`.
5. **Update ref**: PATCH `/repos/{owner}/{repo}/git/refs/heads/{branch}`
   with the new commit SHA and `force=false`. If GitHub returns 422
   ("Update is not a fast-forward"), the remote tip has advanced — the
   commit pipeline raises a `ConflictError` carrying the baseline and
   current tip SHAs, which the conflict policy (FR-022a) consumes.

**Rationale**:

- This is the canonical pattern documented by GitHub for atomic
  multi-file commits and is the only way to satisfy FR-012 ("atomically
  applies all staged operations as a single commit"). The Repository
  Contents API (`PUT /repos/{owner}/{repo}/contents/{path}`) is per-file
  and would produce one commit per file, violating atomicity.
- `force=false` on the ref update is the conflict-detection step
  required by FR-022. A successful PATCH proves no external commit
  landed between staging baseline and commit; a failure surfaces
  cleanly without overwriting external work.
- Delete-by-tree-entry-with-sha-null is GitHub's documented mechanism
  for removing a path from a tree, and it composes cleanly with creates
  and updates in the same tree post — preserving atomicity for FR-016
  collapse outcomes.

**Alternatives considered**:

- **Contents API per file**: Would produce N commits for N changes,
  failing FR-012 atomicity outright.
- **Pull-request based application**: Would require an extra branch
  and merge step, dramatically inflating latency and adding a PR
  artifact in the repository that is not part of the spec.

---

## R-003: Rollback implementation

**Decision**: Implement rollback as a single force-update of the working
branch ref to the parent SHA of the current tip:

1. Fetch the current commit (`GET /repos/{owner}/{repo}/git/commits/{currentSha}`).
2. Read `parents[0].sha`. If absent (initial commit), surface the
   "no prior commit" error required by FR-019.
3. PATCH `/repos/{owner}/{repo}/git/refs/heads/{branch}` with the parent
   SHA and `force=true`. This is the "branch tip reset to parent"
   semantic captured in the spec's Assumptions section.

**Rationale**:

- The spec explicitly describes rollback as "pruning the current commit
  node and checks out to previous commit node" and the Assumptions
  section locks the semantic to "branch tip reset to parent
  (non-fast-forward reset)". A `force=true` ref PATCH is the precise
  GitHub API expression of that semantic.
- `force=true` is unsafe in general but is exactly what the caller
  asked for and accepted in the spec's Assumptions. FR-020 already
  forbids rollback while staged changes exist, so we do not silently
  destroy in-flight work.

**Alternatives considered**:

- **Revert commit**: Adds a new commit on top that inverts the previous
  one. The spec rejects this interpretation: it specifies "pruning
  the current commit node", which is history-rewriting, not
  history-extending.
- **Reset via `git push --force-with-lease` simulation**: GitHub's
  REST API has no `force-with-lease`. We could capture the current
  tip and PATCH with `force=true` only if the captured tip matches
  the current ref. We considered this and rejected it because the
  spec's rollback semantics are intentionally hard reset; layering
  a force-with-lease check adds complexity without changing the
  contract.

---

## R-004: Conflict policy implementation (`fail` / `retry` / `rebase`)

**Decision**: Each commit takes a baseline SHA captured at the start of
the staging session (or the most recent successful commit / rollback /
refresh, whichever is later). The conflict policy is consulted whenever
the ref-update step returns 422:

- **`fail`** (default): The pipeline aborts. The staging area is
  preserved (FR-013 / FR-022b). The caller receives a typed
  `ConflictError` with `{ baselineSha, remoteSha }`.
- **`retry`**: The pipeline re-fetches the new tip, recomputes the
  tree on top of it (re-creating blobs is not required because blob
  SHAs are content-addressed; the new tree is built with the new
  `base_tree` and the same blob SHAs), creates a new commit with the
  new parent, and re-attempts the ref update. The loop is bounded by
  a caller-configurable attempt budget (default 3, hard upper limit
  10) and surfaces `ConflictError` once exhausted.
- **`rebase`**: Same as `retry` *except* the pipeline first compares
  the keys touched by the staged batch against the set of keys
  changed by external commits between `baselineSha` and the new tip.
  The set of externally-changed keys is computed by walking
  `GET /repos/{owner}/{repo}/compare/{baselineSha}...{newSha}` and
  reading the `files[].filename` array. If any staged key intersects
  that set, the pipeline aborts with `ConflictError` listing the
  overlapping keys; otherwise it proceeds as `retry`.

**Rationale**:

- This matches FR-022a's three policies exactly, surfacing the same
  typed `ConflictError` shape for `fail` and `rebase`-overlap paths
  so callers have a single error class to handle.
- The compare endpoint already exists in the GitHub API and returns
  per-file change records, so overlap detection is one API call
  rather than reconstructing tree diffs ourselves.
- Bounding the retry budget (and hard-capping it at 10) prevents a
  misconfigured caller from spinning forever — exactly the safeguard
  FR-028 requires for transient-error retry, applied here too.

**Alternatives considered**:

- **Always rebase**: Convenient but silently overwrites the meaning of
  the `fail` policy. The caller selected `fail` for a reason.
- **No conflict policy (always fail)**: Forces every caller to
  implement retry/rebase themselves. The spec explicitly requires
  built-in policies.
- **Locking via lockfile committed to the repo**: Adds protocol
  complexity, requires extra commits, and breaks for multiple
  external writers. Rejected as over-engineering for v1.

---

## R-005: Read-consistency policy (`fresh` / `cached`)

**Decision**: The `GhDb` instance holds a `cachedTipSha` field that is
updated only by: (a) instance construction (first read), (b) successful
commit, (c) successful rollback, and (d) explicit `refresh()` calls.

- Under `fresh` (default), every `retrieve(key)` first calls
  `GET /repos/{owner}/{repo}/git/refs/heads/{branch}` to refresh the
  cached tip, then resolves the read against that tip.
- Under `cached`, `retrieve(key)` resolves against the cached tip
  without an extra network call. `refresh()` is the only way (other
  than commit / rollback) to update the cache, matching FR-017b.

**Rationale**:

- Implementation is a single boolean branch around a one-line ref
  fetch — small enough to keep the policy as a configuration knob
  rather than two code paths.
- Cached reads under `cached` mode satisfy FR-017a's promise of
  no silent re-fetching, which is critical for callers that want
  predictable read latency.
- The freshness contract under `fresh` mode is "the tip observed at
  the moment of this retrieve" — which is the strongest read freshness
  the GitHub REST API can offer without long polling.

**Alternatives considered**:

- **Always fresh**: Forces a ref fetch on every read, which is wasteful
  in tight loops where the caller knows the tip is stable.
- **Always cached**: Surprises callers who expect read-after-external-write
  visibility without manual `refresh()` calls.

---

## R-006: Retry / backoff for transient GitHub errors

**Decision**: Implement an in-package exponential-backoff retry loop wired
into Octokit via its request hooks. Configuration:

- `maxAttempts` (default 3, hard upper limit 10).
- `baseDelayMs` (default 500ms; hard upper limit 5000ms).
- Backoff schedule: `min(baseDelay * 2^attempt, 30s)` with full jitter.
- If the response carries a `Retry-After` header (primary rate limit)
  or `X-RateLimit-Reset` (secondary rate limit), use that value
  instead of the computed backoff for that attempt.

Transient categories (eligible for retry):

- HTTP 429 (primary rate limit)
- HTTP 403 with `X-RateLimit-Remaining: 0` (secondary rate limit)
- HTTP 5xx (server errors)
- Network errors (no HTTP response — `ECONNRESET`, `ETIMEDOUT`, etc.)

Non-transient categories (surface immediately, never retried):

- HTTP 401 (auth)
- HTTP 403 *without* rate-limit indicator (permission)
- HTTP 404 (not found)
- HTTP 409 (conflict — surfaces as `ConflictError`)
- HTTP 422 (validation) — note: the commit ref-update 422 is *not*
  retried by this layer; conflict policy (R-004) handles it at a
  higher level.

**Rationale**:

- FR-028 mandates bounded exponential backoff with configurable
  limits and an upper bound. Implementing it in-package (rather than
  importing a retry library) keeps the dependency footprint at one
  runtime dep and makes the retry decisions deterministic and
  testable (full jitter is the only random element, and tests inject
  a deterministic RNG).
- Hooking via `octokit.hook.error` and `octokit.hook.wrap` lets the
  retry loop sit transparently underneath every endpoint call,
  including the commit pipeline, repository creation, and webhook
  management — so the "transient → retry" guarantee is uniform.
- Honoring `Retry-After` / `X-RateLimit-Reset` (when present) is
  explicitly required by FR-028. Doing it inside the hook lets us
  read the response headers exactly once and uniformly across
  endpoints.

**Alternatives considered**:

- **`p-retry`** or similar: A third-party retry library would work,
  but it pushes Retry-After header parsing back to gh-db anyway, so
  the saved code is minimal and the dependency cost is real.
- **No jitter**: Convenient for deterministic tests, but synchronized
  thundering-herd retries against a rate-limited GitHub will simply
  rate-limit again. Jitter is standard practice.

---

## R-007: TypeScript build and module formats

**Decision**: Use [`tsup`](https://tsup.egoist.dev/) to produce a dual
ESM (`.mjs` + `.d.mts`) and CJS (`.js` + `.d.ts`) build from
`src/index.ts`. `package.json` declares:

```json
{
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
    }
  }
}
```

**Rationale**:

- TypeScript libraries are consumed today from both ESM (modern
  `package.json` `"type": "module"` projects) and CJS (legacy
  consumers and many Jest setups). Shipping both with correct
  types-conditional exports maximizes compatibility.
- `tsup` is zero-config and uses `esbuild` underneath, producing a
  build in well under a second for this size of codebase.
- The conditional `types` entries follow the
  [TypeScript ESM dual-package guidance](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#package-json-exports-imports-and-self-referencing)
  so consumers get the right `.d.ts` for their import style.

**Alternatives considered**:

- **`tsc` alone**: Produces only one module format unless authored
  twice or post-processed. The two-format ergonomics matter for
  consumer adoption.
- **`rollup` + plugins**: More configurable, but the configuration
  surface area is not worth it for a single-entry library.
- **ESM-only**: Aggressively modern; would lock out CJS consumers
  (still common in 2026 Node tooling).

---

## R-008: Testing framework

**Decision**: Use **vitest** for unit, contract, and integration tests.
Use **nock** for HTTP-level mocking of GitHub API responses.

**Rationale**:

- Vitest is TypeScript-native (no `ts-jest` cycle), runs in-process
  per worker (so individual tests can construct an in-memory
  `GhDb` instance cheaply), and supports `describe.concurrent` for
  fast suites.
- Nock intercepts `http`/`https` (and `undici`/global `fetch` via
  the official adapter) at the transport layer, which means the
  test exercises gh-db's full stack including Octokit's error
  shaping. Mocking Octokit directly would skip exactly the layer
  where error classification and retry hooks live.
- Both projects are mature, well-typed, and widely used.

**Alternatives considered**:

- **Jest**: Equally capable but configuration overhead (especially
  ESM + TypeScript) is higher and execution is slower.
- **Mocha + Chai**: Works but lacks vitest's first-class TS
  ergonomics and parallel-by-default semantics.
- **MSW (Mock Service Worker)**: Excellent for browser/UI testing,
  less idiomatic for a Node library targeting HTTP at the global-fetch
  layer.

---

## R-009: Lint, format, JSDoc enforcement

**Decision**:

- **ESLint** with the following configs combined:
  - `@eslint/js` recommended,
  - `typescript-eslint` strict,
  - `eslint-plugin-jsdoc` recommended-typescript (this is what
    satisfies Constitution III's CI-enforcement requirement),
  - `eslint-config-prettier` to disable stylistic rules that
    conflict with Prettier.
- **Prettier** with default config plus `printWidth: 100`,
  `singleQuote: true`, `trailingComma: 'all'`.
- ESLint runs in CI as `eslint .` and must report zero errors.
  Prettier runs in CI as `prettier --check .` and must report
  clean. Both are also wired as `lint-staged` pre-commit hooks
  for local dev ergonomics.

**Rationale**:

- This is the standard, widely understood TypeScript toolchain
  in 2026. It satisfies Constitution II (Quality Gates) and
  III (JSDoc enforcement) directly and requires no custom
  rules.

**Alternatives considered**:

- **Biome**: Faster combined lint/format, but `eslint-plugin-jsdoc`
  has no Biome equivalent today (2026-05); Constitution III
  requires JSDoc enforcement in CI, so ESLint stays.
- **dprint** for formatting: Faster than Prettier but the
  ecosystem familiarity tradeoff is not worth it for this project.

---

## R-010: On-repository file naming for JSON records

**Decision**: A record stored under key `K` is persisted as the
file `${K}.json` at the root of the working branch.

**Rationale**:

- FR-005b mandates that the file extension is an internal detail
  not exposed to callers. The caller still passes only `K`.
- Using `.json` makes the file viewable as syntax-highlighted JSON
  on github.com and recognizable to any tooling that scans the
  repository, supporting the "transparent persistence" mental
  model that is the whole point of gh-db.
- Key validation (FR-005a) already rules out slashes, backslashes,
  empty strings, and path-traversal segments before staging, so
  the on-disk filename is always a single valid path component.

**Alternatives considered**:

- **No extension**: Callers and casual github.com browsers cannot
  tell the file format from the name. Rejected.
- **Extensionless content-type hint via a sibling manifest**:
  Adds a second file per record and a second source of truth.
  Rejected as over-engineering.

---

## R-011: JSON serialization details

**Decision**:

- On write: `JSON.stringify(value, null, 2)` produces a pretty-printed
  UTF-8 string. Pretty-printing makes github.com diffs human-readable
  and is the canonical encoding for repos used as data stores.
- On write: wrap the call in a `try/catch`. `JSON.stringify` throws
  on circular references and silently drops `undefined` / functions
  at top level. gh-db treats both as `SerializationError` and rejects
  the operation before it enters the staging area (FR-009).
- On read: `JSON.parse(content)` decodes the file body. On parse
  failure, surface a typed `ParseError` containing the key and the
  raw content size (not the content itself, to avoid leaking
  sensitive data through error logs), satisfying FR-006a.

**Rationale**:

- Pretty-printing yields readable diffs at the storage layer, which
  is half the appeal of using GitHub as a datastore in the first
  place.
- Distinguishing `SerializationError` (pre-staging, caller's fault)
  from `ParseError` (read-time, externally-edited or corrupt
  content) directly satisfies FR-026's typed-error-category mandate.

**Alternatives considered**:

- **Compact JSON (no indent)**: Smaller payloads, but unreadable
  diffs. The size delta is negligible for typical records.
- **Sorted keys**: Stable diffs across runs that re-serialize the
  same logical object differently. Considered useful, but not
  required by the spec and adds complexity (custom replacer);
  flagged as a possible follow-up rather than v1 scope.

---

## R-012: Error class hierarchy

**Decision**: Define a single base class `GhDbError extends Error` with a
discriminating `code` field of literal-union type. Concrete subclasses:

- `AuthError` (401)
- `PermissionError` (403, non-rate-limit)
- `NotFoundError` (404)
- `ValidationError` (422 from GitHub on non-commit paths)
- `ConflictError` (commit conflict — covers both `fail` direct outcome
  and `rebase`-overlap outcome; carries `baselineSha`, `remoteSha`, and
  optional `overlappingKeys: string[]`)
- `RateLimitError` (primary or secondary; carries optional `resetAt: Date`)
- `ServerError` (5xx)
- `NetworkError` (transport-level)
- `ParseError` (read-side JSON failure; carries the key)
- `SerializationError` (write-side; carries the key and the failing
  reason, e.g. "circular reference")
- `KeyValidationError` (FR-005a; carries the offending key string)
- `RetryExhaustedError` (FR-030; carries the underlying transient
  category, attempts made, and optional `resetAt`)
- `StagingError` (e.g., stageCreate on a key that already exists at
  HEAD with no pending delete — the create/update semantic from the
  edge cases section)
- `RollbackError` (e.g., FR-019: tip is initial commit; FR-020: staged
  changes present)

**Rationale**:

- A discriminated union via `error.code` lets callers `switch` exhaustively
  with TypeScript inferring the carry-payload fields per branch.
- Every distinct GitHub failure category from FR-026 maps to a unique
  class. SC-006's "error-coverage matrix" is therefore a static check
  against this enumeration.

**Alternatives considered**:

- **One flat error class with a string `kind`**: Loses TypeScript
  payload narrowing.
- **Per-endpoint error classes**: Explodes the surface area without
  giving callers anything they cannot already get from `code`.

---

## R-013: Webhook event-type identifiers

**Decision**: Accept event type identifiers as `string[]` and forward
verbatim to GitHub's `events` field on the hook creation endpoint.
gh-db does not enumerate or validate event names beyond a non-empty
string check; GitHub itself rejects unknown event names with a 422,
which surfaces as `ValidationError`.

**Rationale**:

- GitHub adds new event types over time; hard-coding the list would
  date the package.
- The spec (FR-023) requires accepting "a list of event types"; it
  does not require gh-db to maintain a local catalog.

**Alternatives considered**:

- **Enumerated TS union of known event types**: Helpful IDE
  autocomplete but stale immediately whenever GitHub adds a new
  event. Flagged as a possible follow-up using a generated
  type from GitHub's OpenAPI spec.

---

## R-014: Concurrency baseline SHA tracking

**Decision**: The staging area records `baselineSha` at the moment the
*first* staged operation enters an otherwise-empty staging area. The
field is cleared on `reset()`, successful `commit()`, successful
`rollback()`, and explicit `refresh()`. Subsequent staged operations
attach to the same baseline.

**Rationale**:

- FR-022 says "the remote branch tip has advanced beyond the tip seen
  when staging began". This decision pins "the tip seen when staging
  began" to a single, well-defined moment: the start of the current
  staging session. This is consistent with the `cached` read policy
  and ensures `rebase`-policy overlap detection (R-004) has a stable
  reference point.
- Clearing on reset/commit/rollback/refresh keeps the baseline fresh
  for the next staging session.

**Alternatives considered**:

- **Per-operation baseline**: Each staged op refetches the tip. Adds
  N round trips per staging session for no extra correctness.
- **Pinned at instance construction**: Becomes stale immediately
  after any commit and offers no extra value.

---

## R-015: GitHub Enterprise base URL composition

**Decision**: The `baseUrl` config option, when provided, is passed
verbatim to Octokit. We do not append `/api/v3` automatically;
callers supply the full base URL exactly as Octokit expects
(`https://github.enterprise.example.com/api/v3` for GHES).
Documentation calls this out explicitly with examples.

**Rationale**:

- Octokit's convention is well-known among GitHub Enterprise users.
- Hiding the `/api/v3` segment would surprise users who already
  know Octokit's contract and would force gh-db to maintain a
  detect-or-append heuristic.

**Alternatives considered**:

- **Detect host and append `/api/v3` if not present**: Fragile
  (GHEC custom domains may use a different prefix; future GitHub
  Enterprise versions may move).
- **Take only the hostname and synthesize the URL**: Loses the
  flexibility callers need for GHEC custom domains.

---

## Open items resolved

The spec went through `/speckit-clarify` on 2026-05-20 and arrived at
this phase with **zero** outstanding `NEEDS CLARIFICATION` markers.
The Technical Context section in `plan.md` reflects this: no field is
marked `NEEDS CLARIFICATION`.

## Out-of-scope (deferred / not researched)

- Browser bundle. Out of scope per the Assumptions section of the spec
  and FR-001's "Node.js runtime" framing.
- OAuth flow. Out of scope per the Assumptions section; callers supply
  a pre-minted token.
- Multi-step rollback in one call. Out of scope per the Assumptions
  section (single-commit-step granularity).
- Branch creation / management beyond reading the configured working
  branch. Out of scope: the spec defines a single working branch per
  instance and does not require branch lifecycle management.
- Live integration test infrastructure (CI tokens, throwaway repos).
  Flagged as a follow-up; the plan accommodates opt-in live tests but
  does not block CI on them.
