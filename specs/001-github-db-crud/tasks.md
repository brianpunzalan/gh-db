---
description: "Task list for gh-db — GitHub as a Persistent Data Store"
---

# Tasks: gh-db — GitHub as a Persistent Data Store

**Input**: Design documents from `/specs/001-github-db-crud/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Unit test tasks are MANDATORY per the project constitution (Principle I). Every module
under `src/` MUST have a sibling unit test under `tests/unit/` covering the success path and at
least one failure / edge case. Tests MUST be written before their implementation tasks are marked
complete.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing
of each story. User stories US1 and US2 are both P1; US3 and US4 are P2; US5 is P3. The MVP is
defined as US1 (with `fail` conflict policy as the minimum) — see Implementation Strategy.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5)
- Include exact file paths in descriptions

## Path Conventions

Single TypeScript library project (per plan.md). All sources under `src/`, all tests under
`tests/` at the repository root. Configuration files (`package.json`, `tsconfig.json`,
`tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, CI workflow) live at
the repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependency installation, and toolchain configuration so all
subsequent phases can build, lint, format, and test.

- [x] T001 Create source tree directories per plan.md: `src/{core,client,crud,staging,commit,conflict,rollback,repository,webhooks,retry,serialization,validation,errors,types}/` and `tests/{unit/{core,client,crud,staging,commit,conflict,rollback,repository,webhooks,retry,serialization,validation,errors},contract,integration}/`
- [x] T002 [P] Initialize `package.json` at repo root with name `gh-db`, version `0.1.0`, `type: module`, dual ESM/CJS exports map (per research R-007), `engines.node` `>=18`, scripts (`build`, `test`, `lint`, `format`, `typecheck`), and dependencies: `@octokit/rest@^21`, `@octokit/request-error`; devDependencies: `typescript@^5.4`, `tsup`, `vitest`, `nock`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-jsdoc`, `eslint-config-prettier`, `prettier`
- [x] T003 [P] Create `tsconfig.json` at repo root: target ES2022, module ESNext, moduleResolution Bundler, strict, declaration, declarationMap, sourceMap, lib `['ES2022']`, include `['src/**/*', 'tests/**/*']`
- [x] T004 [P] Create `tsup.config.ts` at repo root: entry `src/index.ts`, format `['esm', 'cjs']`, dts true, clean true, sourcemap true, target `node18`
- [x] T005 [P] Create `vitest.config.ts` at repo root: globals false, environment `node`, include `['tests/**/*.test.ts']`, coverage provider `v8`
- [x] T006 [P] Create `eslint.config.js` at repo root combining `@eslint/js` recommended, `typescript-eslint` strict, `eslint-plugin-jsdoc` recommended-typescript with `require-jsdoc` on every exported symbol (Constitution III), and `eslint-config-prettier`
- [x] T007 [P] Create `.prettierrc` at repo root: `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`
- [x] T008 [P] Create `.github/workflows/ci.yml` running `vitest run`, `eslint .`, and `prettier --check .` on Node 18 and Node 20 matrices (Constitution II)
- [x] T009 [P] Create `CHANGELOG.md` at repo root using Keep-a-Changelog format with an empty `[Unreleased]` section (Constitution V)
- [x] T010 [P] Create `README.md` skeleton at repo root with sections: Overview, Installation, Quickstart (placeholder), Configuration, API, Errors, Webhooks, GitHub Enterprise, Development. Detailed content lands in Polish phase.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement the cross-cutting modules every user story depends on: public types, the
typed error hierarchy, key validation, JSON serialization, the retry/backoff/classify pipeline,
the Octokit client factory, the instance config parser, the in-memory staging area, and the
`GhDb` class skeleton (constructor + state holders). User-story phases will then add methods to
the `GhDb` class without re-implementing any cross-cutting logic.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (MANDATORY per Constitution Principle I)

> Write each test FIRST, ensure it FAILS before implementing the matching module.

- [x] T011 [P] Unit test errors hierarchy (every subclass has correct `code`, inheritance, optional payload fields) in `tests/unit/errors/errors.test.ts`
- [x] T012 [P] Unit test key validation (FR-005a: empty, contains `/`, contains `\`, `.`, `..`, control chars, valid keys) in `tests/unit/validation/key.test.ts`
- [x] T013 [P] Unit test JSON encode (success, circular reference throws SerializationError, function/BigInt/undefined-top-level cases, pretty-printing) in `tests/unit/serialization/encode.test.ts`
- [x] T014 [P] Unit test JSON decode (success returns deserialized value, malformed JSON throws ParseError carrying key + contentSizeBytes) in `tests/unit/serialization/decode.test.ts`
- [x] T015 [P] Unit test retry classify (every row of the HTTP status table in contracts/errors.md) in `tests/unit/retry/classify.test.ts`
- [x] T016 [P] Unit test exponential backoff (schedule `min(base * 2^attempt, 30s)` with jittered RNG, Retry-After / X-RateLimit-Reset honoring, upper bound) in `tests/unit/retry/backoff.test.ts`
- [x] T017 [P] Unit test retry loop (transient retried up to budget, non-transient surfaces immediately, RetryExhaustedError on budget exhaustion with underlying category + attempts) in `tests/unit/retry/retry-loop.test.ts`
- [x] T018 [P] Unit test HTTP error mapping from Octokit RequestError to typed gh-db errors (uses recorded fixture status/headers) in `tests/unit/client/http-error.test.ts`
- [x] T019 [P] Unit test Octokit client factory (passes `auth`, `baseUrl`, `userAgent`; installs retry hook; defaults baseUrl to `https://api.github.com`) in `tests/unit/client/octokit-client.test.ts`
- [x] T020 [P] Unit test instance config parser (defaults, clamping of `conflictMaxAttempts`/`retryMaxAttempts`/`retryBaseDelayMs`, invalid `conflictPolicy`/`readConsistency` values, empty `auth`/`owner`/`repo`) in `tests/unit/core/instance-config.test.ts`
- [x] T021 [P] Unit test staging area data structure (add op, get by key, all(), size, clear, captures `baselineSha`/`baselineTreeSha` on first op, clears them on empty) in `tests/unit/staging/staging-area.test.ts`
- [x] T022 [P] Unit test collapse rules (every row of the collapse table in data-model.md Entity 3) in `tests/unit/staging/collapse.test.ts`
- [x] T023 [P] Unit test listStaged inspect (returns shallow copy, includes kind/key/value/enqueuedAt, mutating returned array does not affect staging) in `tests/unit/staging/inspect.test.ts`
- [x] T024 [P] Unit test GhDb constructor (validates config, holds instance config + cached tip + staging area + client; does NOT contact GitHub on construction) in `tests/unit/core/gh-db.test.ts`
- [x] T025 [P] Contract test for public API shape: verify every symbol from contracts/public-api.md is exported from `src/index.ts` and no others in `tests/contract/public-api-shape.test.ts`

### Implementation for Foundational

- [x] T026 [P] Implement public types (`JsonValue`, `ConflictPolicy`, `ReadConsistencyPolicy`, `StagedOperationKind`, `GhDbConfig`, `CommitOptions`, `CommitResult`, `StagedOperation`, `CreateRepositoryOptions`, `CreateRepositoryResult`, `WebhookSubscriptionOptions`, `WebhookSubscription`, `RetrieveResult`) in `src/types/public.ts`
- [x] T027 [P] Implement error hierarchy (`GhDbError` base, `AuthError`, `PermissionError`, `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitError`, `ServerError`, `NetworkError`, `ParseError`, `SerializationError`, `KeyValidationError`, `RetryExhaustedError`, `StagingError`, `RollbackError`, `GhDbErrorCode` literal union) in `src/errors/index.ts`
- [x] T028 [P] Implement key validation per FR-005a (`^[^/\\]+$`, reject `.`, `..`, empty, whitespace-only, control chars) in `src/validation/key.ts`
- [x] T029 [P] Implement JSON encode (`JSON.stringify(value, null, 2)`, catch + classify into `SerializationError` with `reason: 'circular' | 'unsupported_type' | 'undefined_top_level'`) in `src/serialization/encode.ts`
- [x] T030 [P] Implement JSON decode (`JSON.parse(content)`, catch + map to `ParseError` carrying `key` and `contentSizeBytes`) in `src/serialization/decode.ts`
- [x] T031 [P] Implement retry classify per contracts/errors.md HTTP table (read status + `x-ratelimit-remaining` + `retry-after` + `x-ratelimit-reset` headers from Octokit `RequestError`) in `src/retry/classify.ts`
- [x] T032 [P] Implement bounded exponential backoff with full jitter (`min(baseDelayMs * 2^attempt, 30000)` ms; honors `Retry-After` / `X-RateLimit-Reset` when present) in `src/retry/backoff.ts`
- [x] T033 Implement retry loop wired around an async callable (depends on T031, T032): retries transient categories up to `retryMaxAttempts`; throws `RetryExhaustedError` carrying `underlying` + `attempts` + optional `resetAt` on exhaustion in `src/retry/retry-loop.ts`
- [x] T034 [P] Implement HTTP error mapping from `@octokit/request-error` `RequestError` to typed gh-db errors per contracts/errors.md HTTP table in `src/client/http-error.ts`
- [x] T035 Implement Octokit client factory (depends on T033, T034): creates one `Octokit` instance per gh-db instance with `auth`, `baseUrl` (default `https://api.github.com`), `userAgent`; installs `octokit.hook.wrap` calling the retry loop and `octokit.hook.error` mapping via `http-error` in `src/client/octokit-client.ts`
- [x] T036 Implement instance config parser (depends on T026, T027, T028): validates owner/repo/branch/baseUrl/auth, clamps numeric bounds to documented ranges, returns immutable `InstanceConfig` in `src/core/instance-config.ts`
- [x] T037 [P] Implement staging area data structure (`Map<string, StagedOperation>` keyed by record `key`, plus `baselineSha` / `baselineTreeSha` capture and clearing) in `src/staging/staging-area.ts`
- [x] T038 [P] Implement collapse rules per data-model.md Entity 3 table (consumed by staging area when adding a new op) in `src/staging/collapse.ts`
- [x] T039 Implement `listStaged` inspect (depends on T037): returns a shallow-copy array of `StagedOperation` with kind/key/value/enqueuedAt in `src/staging/inspect.ts`
- [x] T040 Implement `GhDb` class skeleton (depends on T035, T036, T037): constructor parses config, instantiates Octokit client, initializes empty staging area and undefined cached tip; class fields ready for user-story methods. Does NOT contact GitHub on construction. In `src/core/gh-db.ts`
- [x] T041 Implement public entry point with the exact exports listed in contracts/public-api.md (no other symbols) in `src/index.ts`

**Checkpoint**: Foundation ready — every cross-cutting capability tested and implemented. User
story implementation can now begin in parallel.

---

## Phase 3: User Story 1 — Create, Stage, Commit JSON Records (Priority: P1) 🎯 MVP

**Goal**: A developer can create one or more JSON records in memory via gh-db, see them in the
staging view, and commit them atomically as a single GitHub commit on the working branch with a
chosen message, with conflict detection against external commits according to a caller-selectable
policy (`fail` default, `retry`, or `rebase`).

**Independent Test**: With access to a real GitHub account and PAT, (a) point gh-db at an empty
repo, (b) `stageCreate` three records, (c) `listStaged()` shows all three pending, (d) `commit`
with a message, (e) verify on github.com exactly one new commit exists with the three files and
correct JSON content. Repeat with `conflictPolicy: 'fail'` after another writer pushes between
staging and commit → `ConflictError` and staging intact. (Stories 1 acceptance scenarios 1–4.)

### Tests for User Story 1 (MANDATORY per Constitution Principle I)

- [x] T042 [P] [US1] Unit test stageCreate (validates key/value, rejects when key exists at HEAD or as pending create/update, collapses against pending delete) in `tests/unit/crud/create.test.ts`
- [x] T043 [P] [US1] Unit test tree builder (composes new `tree` array from base tree + staged ops, sets `sha=null` for deletes, preserves untouched entries) in `tests/unit/commit/tree-builder.test.ts`
- [x] T044 [P] [US1] Unit test commit pipeline (sequences blobs → tree → commit → ref update; surfaces 422-not-fast-forward as `ConflictError` with `baselineSha`/`remoteSha`) in `tests/unit/commit/pipeline.test.ts`
- [x] T045 [P] [US1] Unit test conflict policy selector (validates `'fail' | 'retry' | 'rebase'`, per-commit override beats instance default) in `tests/unit/conflict/policy.test.ts`
- [x] T046 [P] [US1] Unit test overlap detection (calls `GET /compare/{base}...{head}`, intersects `files[].filename` with staged keys appended with `.json`) in `tests/unit/conflict/overlap.test.ts`
- [x] T047 [P] [US1] Unit test rebase logic (no overlap → replay on new tip; overlap → `ConflictError` with `overlappingKeys`) in `tests/unit/conflict/rebase.test.ts`
- [x] T048 [P] [US1] Unit test commit orchestrator (rejects empty/whitespace `message` with `ValidationError`; on conflict consults policy; clears staging area only on success; preserves staging area on every failure path per FR-013/FR-022b) in `tests/unit/commit/commit-orchestrator.test.ts`
- [x] T049 [P] [US1] Integration test for create+stage+commit (3 creates → listStaged shows 3 → commit → 1 new GitHub commit with 3 files; empty staging after commit) in `tests/integration/crud-commit-flow.test.ts`
- [x] T050 [P] [US1] Integration test for `'fail'` conflict policy (concurrent external commit between staging and commit → `ConflictError` with staging area intact) in `tests/integration/conflict-policy-fail.test.ts`
- [x] T051 [P] [US1] Integration test for `'retry'` conflict policy (concurrent external commit on different keys → success after replay; conflict on every attempt → `ConflictError` after budget) in `tests/integration/conflict-policy-retry.test.ts`
- [x] T052 [P] [US1] Integration test for `'rebase'` conflict policy (overlapping key → `ConflictError` with `overlappingKeys`; non-overlapping → success) in `tests/integration/conflict-policy-rebase.test.ts`

### Implementation for User Story 1

- [x] T053 [P] [US1] Implement `stageCreate(key, value)` (validates key, encodes value, computes net effect against existing staged op via collapse, enqueues into staging area, captures baseline if first op) in `src/crud/create.ts`
- [x] T054 [P] [US1] Implement tree builder (input: base tree SHA + map of `key → { kind, blobSha? }`; output: tree-creation request body with `base_tree` + per-entry `{ path: '<key>.json', mode: '100644', type: 'blob', sha: blobSha | null }`) in `src/commit/tree-builder.ts`
- [x] T055 [US1] Implement commit pipeline (depends on T054 and the Octokit client): POST blobs → POST tree → POST commit → PATCH ref with `force=false`; surface 422-not-fast-forward as `ConflictError` carrying `baselineSha`/`remoteSha` in `src/commit/pipeline.ts`
- [x] T056 [P] [US1] Implement conflict policy selector (resolves per-commit override over instance default, returns literal `'fail' | 'retry' | 'rebase'`) in `src/conflict/policy.ts`
- [x] T057 [P] [US1] Implement overlap detector via `GET /repos/{owner}/{repo}/compare/{baselineSha}...{remoteSha}` → returns set of externally-changed `key`s by stripping `.json` from `files[].filename` in `src/conflict/overlap.ts`
- [x] T058 [US1] Implement rebase logic (depends on T055, T057): on conflict, fetch new tip, call overlap detector, if no overlap rebuild tree on new `base_tree` (blobs are content-addressed so do not re-post) and retry up to `conflictMaxAttempts`; on overlap throw `ConflictError` with `overlappingKeys` in `src/conflict/rebase.ts`
- [x] T059 [US1] Implement commit orchestrator (depends on T055, T056, T058): validates non-empty `message` (FR-014), invokes pipeline, on `ConflictError` consults policy; on success clears staging and updates cached tip; on every failure path leaves staging intact (FR-013/FR-022b) in `src/commit/commit-orchestrator.ts`
- [x] T060 [US1] Wire `GhDb.stageCreate`, `GhDb.listStaged`, `GhDb.commit` methods to delegate to T053 / T039 / T059 in `src/core/gh-db.ts`

**Checkpoint**: User Story 1 is fully functional — a developer can stage creates, inspect the
batch, and commit atomically with conflict detection under all three policies. Quickstart
"Story 1" walkthrough passes end-to-end. This is the MVP.

---

## Phase 4: User Story 2 — Retrieve and Update Existing Records (Priority: P1)

**Goal**: A developer can read JSON records by key (staging-aware, with `'fresh'` or `'cached'`
read consistency), stage updates and deletes alongside creates, reset the staging area without
committing, and explicitly refresh the cached tip under `'cached'` mode.

**Independent Test**: After US1 populated the repo, (a) retrieve a record by key — returns the
JSON object; (b) retrieve a non-existent key — returns `{ found: false }`; (c) stage an update +
a delete + a create, (d) `reset()`, (e) confirm staging empty and repo unchanged; (f) re-stage
and commit — observe the expected resulting file set on github.com. Repeat with
`readConsistency: 'cached'` and verify reads do not re-fetch the tip until `refresh()` is called.
(Stories 2 acceptance scenarios 1–5.)

### Tests for User Story 2 (MANDATORY per Constitution Principle I)

- [x] T061 [P] [US2] Unit test `retrieve` (staging-through for pending create/update/delete; `'fresh'` re-fetches tip per call; `'cached'` does not; calls Contents API once per read; decodes base64; parses JSON; returns `{ found: true, value } | { found: false }`; surfaces `ParseError` on malformed JSON) in `tests/unit/crud/retrieve.test.ts`
- [x] T062 [P] [US2] Unit test `stageUpdate` (validates key/value, rejects when no record exists in committed state or as pending create, collapses against pending update/create) in `tests/unit/crud/update.test.ts`
- [x] T063 [P] [US2] Unit test `stageDelete` (validates key, rejects on missing record, collapses create+delete → no commit entry) in `tests/unit/crud/delete.test.ts`
- [x] T064 [US2] Extend `tests/integration/crud-commit-flow.test.ts` (created in T049) with Story 2 scenarios: retrieve known + unknown keys, mixed-op stage → reset → repo unchanged, re-stage + commit → expected file set, two stageUpdates on same key collapse to last value, `'cached'` policy + `refresh()` end-to-end

### Implementation for User Story 2

- [x] T065 [P] [US2] Implement `retrieve(key)` (staging-through for any pending op for `key`; under `'fresh'` GETs `/git/refs/heads/{branch}` then GETs `/contents/{key}.json?ref={sha}`; under `'cached'` GETs `/contents/{key}.json?ref={cachedTipSha}`; decodes base64; calls decode module; 404 → `{ found: false }`; other errors propagated typed) in `src/crud/retrieve.ts`
- [x] T066 [P] [US2] Implement `stageUpdate(key, value)` (validates key + value, checks existence via cached tree or lazy retrieve, computes collapse, enqueues, captures baseline if first op) in `src/crud/update.ts`
- [x] T067 [P] [US2] Implement `stageDelete(key)` (validates key, checks existence, computes collapse including create+delete → cancel, enqueues, captures baseline if first op) in `src/crud/delete.ts`
- [x] T068 [US2] Wire `GhDb.retrieve`, `GhDb.stageUpdate`, `GhDb.stageDelete`, `GhDb.reset` (clears staging area, no network), `GhDb.refresh` (GET ref → update cached tip, return new SHA) in `src/core/gh-db.ts`

**Checkpoint**: Stories 1 AND 2 both work independently. Quickstart "Story 2" walkthrough passes.

---

## Phase 5: User Story 3 — Rollback to Previous Commit (Priority: P2)

**Goal**: A developer can call `rollback()` to force-update the working branch tip to the parent
of the current tip. Subsequent reads reflect the pre-rollback state. The most recent commit is
removed from history.

**Independent Test**: After US1 + US2, (a) note current tip SHA, (b) make and commit a change,
(c) `rollback()`, (d) verify the branch tip equals the previously-noted SHA, (e) `retrieve` an
affected key — value matches pre-rollback. (Story 3 acceptance scenarios 1–4.)

### Tests for User Story 3 (MANDATORY per Constitution Principle I)

- [x] T069 [P] [US3] Unit test rollback (success path: GET commit → read `parents[0].sha` → PATCH ref with `force: true`; refuses when staging non-empty (`RollbackError` with `reason: 'staging_not_empty'`); refuses when tip is initial commit / no parents (`RollbackError` with `reason: 'initial_commit'`); updates cached tip on success) in `tests/unit/rollback/rollback.test.ts`
- [x] T070 [P] [US3] Integration test rollback flow (commit → rollback → branch tip is parent SHA → retrieve returns pre-rollback value) in `tests/integration/rollback-flow.test.ts`

### Implementation for User Story 3

- [x] T071 [P] [US3] Implement rollback (GET `/git/commits/{currentSha}` → read `parents[0].sha`; throw `RollbackError {reason:'initial_commit'}` if absent; throw `RollbackError {reason:'staging_not_empty'}` if staging non-empty; PATCH `/git/refs/heads/{branch}` with parent SHA + `force: true`; update cached tip) in `src/rollback/rollback.ts`
- [x] T072 [US3] Wire `GhDb.rollback` to delegate to T071 in `src/core/gh-db.ts`

**Checkpoint**: Stories 1, 2, AND 3 all work independently. Quickstart "Story 3" walkthrough passes.

---

## Phase 6: User Story 4 — Provision a New Repository (Priority: P2)

**Goal**: A developer can call `createRepository(options)` to provision a new GitHub repository
under the configured account/organization with a name and visibility, returning a handle the
caller uses for subsequent gh-db operations. "Already exists" is distinguishable from other
failures.

**Independent Test**: (a) Call `createRepository({name, visibility})` with unique name → returns
`{owner, name, defaultBranch, initialCommitSha}`; (b) repeat with same name → throws
`ValidationError { subcode: 'already_exists' }`; (c) call without `repo` scope on the token →
throws `PermissionError`. (Story 4 acceptance scenarios 1–3.)

### Tests for User Story 4 (MANDATORY per Constitution Principle I)

- [x] T073 [P] [US4] Unit test createRepository (calls `POST /user/repos` when no `organization`, `POST /orgs/{org}/repos` when supplied; sends `auto_init: true`; maps `visibility` → `private` bool; 422 "name already exists" → `ValidationError {subcode:'already_exists'}`; 403 no rate-limit → `PermissionError`) in `tests/unit/repository/create-repository.test.ts`
- [x] T074 [P] [US4] Integration test repository creation flow (createRepository → immediately stage + commit a record on the returned repo) in `tests/integration/repository-creation-flow.test.ts`

### Implementation for User Story 4

- [x] T075 [P] [US4] Implement `createRepository` (chooses endpoint based on `organization`, sends `{name, private: visibility === 'private', auto_init: true, description}`; on 422 inspect body for `errors[].message` containing `'name already exists'` → `ValidationError {subcode:'already_exists'}`; returns `{owner, name, defaultBranch, initialCommitSha}`) in `src/repository/create-repository.ts`
- [x] T076 [US4] Wire `GhDb.createRepository` to delegate to T075 in `src/core/gh-db.ts`

**Checkpoint**: Stories 1, 2, 3, AND 4 all work independently. Quickstart "Story 4" walkthrough passes.

---

## Phase 7: User Story 5 — Subscribe to Repository Webhooks (Priority: P3)

**Goal**: A developer can register a webhook on the configured repository with a callback URL
and event types, list currently registered webhooks, and unsubscribe by hook id.

**Independent Test**: (a) `subscribeWebhook({callbackUrl, events:['push']})` returns a
`WebhookSubscription` with `id`; (b) `listWebhooks()` includes the new entry; (c) commit something
via gh-db → callback URL receives a `push` event within 30 s; (d) `unsubscribeWebhook(id)` removes
the webhook and further commits do not deliver to that URL. (Story 5 acceptance scenarios 1–4.)

### Tests for User Story 5 (MANDATORY per Constitution Principle I)

- [x] T077 [P] [US5] Unit test `subscribeWebhook` (validates `events.length >= 1` + every element non-empty string + valid `callbackUrl` URL; POSTs `/repos/{owner}/{repo}/hooks` with `{name:'web', active, events, config:{url, content_type:'json'}}`; 422 invalid event → `ValidationError {subcode:'invalid_event'}`) in `tests/unit/webhooks/subscribe.test.ts`
- [x] T078 [P] [US5] Unit test `listWebhooks` (GETs `/repos/{owner}/{repo}/hooks`, maps response to `WebhookSubscription[]` including `lastDeliveryStatus` when present) in `tests/unit/webhooks/list.test.ts`
- [x] T079 [P] [US5] Unit test `unsubscribeWebhook` (DELETEs `/repos/{owner}/{repo}/hooks/{id}`; 404 → `NotFoundError {resourceKind:'hook'}`) in `tests/unit/webhooks/unsubscribe.test.ts`
- [x] T080 [P] [US5] Integration test webhook flow (subscribe → list → unsubscribe; 422 on bad event) in `tests/integration/webhook-flow.test.ts`

### Implementation for User Story 5

- [x] T081 [P] [US5] Implement `subscribeWebhook` (input validation per contracts/webhook-events.md, POST hook, map response to `WebhookSubscription`) in `src/webhooks/subscribe.ts`
- [x] T082 [P] [US5] Implement `listWebhooks` (GET hooks, map to `WebhookSubscription[]`) in `src/webhooks/list.ts`
- [x] T083 [P] [US5] Implement `unsubscribeWebhook` (DELETE hook by id, treat 404 as `NotFoundError {resourceKind:'hook'}`) in `src/webhooks/unsubscribe.ts`
- [x] T084 [US5] Wire `GhDb.subscribeWebhook`, `GhDb.listWebhooks`, `GhDb.unsubscribeWebhook` to delegate to T081/T082/T083 in `src/core/gh-db.ts`

**Checkpoint**: All five user stories work independently. Quickstart "Story 5" walkthrough passes.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verify the package is shippable: end-to-end contract conformance, full README,
v0.1.0 changelog entry, JSDoc coverage, build verification, and edge-case coverage that cuts
across all stories.

- [x] T085 [P] Contract test for GitHub REST shape: recorded-fixture conformance for every endpoint in contracts/github-endpoints.md (repository create, branch ref read, contents read, git blobs/trees/commits/refs, compare, hooks) in `tests/contract/github-rest-shape.test.ts`
- [x] T086 [P] Expand `README.md` with full Quickstart content from `specs/001-github-db-crud/quickstart.md` (all five stories), API reference linking to JSDoc, the documented event-type table from contracts/webhook-events.md, error-handling pattern, and GitHub Enterprise notes
- [x] T087 [P] Edge-case integration coverage: large single record (~1 MB), 50-record commit batch atomicity (SC-002), rate-limit retry honoring `Retry-After`, token-expiry mid-session → `AuthError` on next call, in `tests/integration/edge-cases.test.ts`
- [ ] T088 Run quickstart.md end-to-end against a real throwaway GitHub repository (gated on `GH_DB_LIVE_TOKEN` / `GH_DB_LIVE_REPO` env vars; opt-in, not blocking CI) to validate SC-001 (under 15 minutes to first commit) — document the run in `CHANGELOG.md`
- [x] T089 [P] Update `CHANGELOG.md` `[Unreleased]` → `[0.1.0]` with `Added` entries for every user story (US1–US5), conflict policies, read-consistency policies, retry layer, typed error categories, and GitHub Enterprise support (Constitution V)
- [x] T090 Build verification: run `tsup` and inspect `dist/` for `index.js` (CJS), `index.mjs` (ESM), `index.d.ts`, `index.d.mts`; verify `package.json` exports map resolves correctly in both `require('gh-db')` and `import 'gh-db'` smoke tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies — can start immediately.
- **Phase 2 Foundational**: Depends on Setup. BLOCKS all user stories.
- **Phase 3 US1 (P1) [MVP]**: Depends on Foundational.
- **Phase 4 US2 (P1)**: Depends on Foundational. May reuse staging area + GhDb scaffold from
  Foundational. T064 extends the integration file T049 created in US1, so US1 must merge first;
  US2 implementation tasks themselves do not depend on US1 implementation modules.
- **Phase 5 US3 (P2)**: Depends on Foundational. Independent of US1/US2 implementation modules
  (only depends on the GhDb scaffold). The integration test relies on US1+US2 to set up state,
  so demo-end-to-end ordering is US1 → US2 → US3.
- **Phase 6 US4 (P2)**: Depends on Foundational. Fully independent of US1/US2/US3.
- **Phase 7 US5 (P3)**: Depends on Foundational. Fully independent of US1/US2/US3/US4.
- **Phase 8 Polish**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests MUST be written and FAIL before implementation per Constitution Principle I.
- Within implementation: leaf modules (no deps) before compound modules; the `GhDb` wire-up task
  is always the last task of the phase.

### Parallel Opportunities

- **Phase 1**: T002–T010 all `[P]` — every config file is independent.
- **Phase 2**: All 15 tests `[P]` (T011–T025). Implementation tasks T026–T032, T034, T037–T038
  are leaf and `[P]`; T033, T035, T036, T039, T040, T041 are not `[P]` because they depend on
  other foundational modules.
- **Phase 3 US1**: All 11 tests `[P]` (T042–T052). Implementation T053/T054/T056/T057 are `[P]`;
  T055 (pipeline) depends on T054; T058 (rebase) depends on T055+T057; T059 (orchestrator)
  depends on T055/T056/T058; T060 (wire) is last.
- **Phase 4 US2**: T061–T063 unit tests `[P]`; T064 extends a US1 file (not `[P]` with itself,
  but `[P]` with T061–T063). Implementation T065/T066/T067 are `[P]`; T068 (wire) is last.
- **Phase 5 US3**: T069 (test) `[P]` with T070 (integration). T071 `[P]`; T072 (wire) is last.
- **Phase 6 US4**: T073 `[P]` with T074. T075 `[P]`; T076 (wire) is last.
- **Phase 7 US5**: T077–T080 all `[P]`. T081/T082/T083 all `[P]`; T084 (wire) is last.
- **Phase 8 Polish**: T085/T086/T087/T089 all `[P]`; T088 + T090 are gated on the build artifacts.

### Cross-story parallelism (with multiple developers)

Once Phase 2 (Foundational) is merged, US1, US3, US4, and US5 can be developed in parallel by
four developers. US2 can also proceed in parallel with US1 because they touch independent CRUD
modules, but the integration test in T064 must rebase onto US1's T049 before merge.

---

## Parallel Example: Phase 2 Foundational Tests

All 15 foundational tests can be authored in parallel (they live in separate files):

```bash
Task: "Unit test errors hierarchy in tests/unit/errors/errors.test.ts"
Task: "Unit test key validation in tests/unit/validation/key.test.ts"
Task: "Unit test JSON encode in tests/unit/serialization/encode.test.ts"
Task: "Unit test JSON decode in tests/unit/serialization/decode.test.ts"
Task: "Unit test retry classify in tests/unit/retry/classify.test.ts"
Task: "Unit test exponential backoff in tests/unit/retry/backoff.test.ts"
Task: "Unit test retry loop in tests/unit/retry/retry-loop.test.ts"
Task: "Unit test HTTP error mapping in tests/unit/client/http-error.test.ts"
Task: "Unit test Octokit client factory in tests/unit/client/octokit-client.test.ts"
Task: "Unit test instance config parser in tests/unit/core/instance-config.test.ts"
Task: "Unit test staging area data structure in tests/unit/staging/staging-area.test.ts"
Task: "Unit test collapse rules in tests/unit/staging/collapse.test.ts"
Task: "Unit test listStaged inspect in tests/unit/staging/inspect.test.ts"
Task: "Unit test GhDb constructor in tests/unit/core/gh-db.test.ts"
Task: "Contract test public API shape in tests/contract/public-api-shape.test.ts"
```

## Parallel Example: Phase 3 US1 Tests

All 11 US1 tests can be authored in parallel:

```bash
Task: "Unit test stageCreate in tests/unit/crud/create.test.ts"
Task: "Unit test tree builder in tests/unit/commit/tree-builder.test.ts"
Task: "Unit test commit pipeline in tests/unit/commit/pipeline.test.ts"
Task: "Unit test conflict policy selector in tests/unit/conflict/policy.test.ts"
Task: "Unit test overlap detection in tests/unit/conflict/overlap.test.ts"
Task: "Unit test rebase logic in tests/unit/conflict/rebase.test.ts"
Task: "Unit test commit orchestrator in tests/unit/commit/commit-orchestrator.test.ts"
Task: "Integration test crud-commit-flow in tests/integration/crud-commit-flow.test.ts"
Task: "Integration test conflict-policy-fail in tests/integration/conflict-policy-fail.test.ts"
Task: "Integration test conflict-policy-retry in tests/integration/conflict-policy-retry.test.ts"
Task: "Integration test conflict-policy-rebase in tests/integration/conflict-policy-rebase.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

The MVP is User Story 1: a developer can persist JSON records to a GitHub repository via
gh-db's commit pipeline, with the `fail` conflict policy (the minimum required to satisfy
FR-022's "never silently overwrite"). The `retry` / `rebase` policies are also delivered in
US1 because they share the commit-pipeline code path, but a partial-US1 release exposing only
the `fail` policy would still be a usable MVP.

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories).
3. Complete Phase 3: User Story 1 (with all three conflict policies).
4. **STOP and VALIDATE**: Quickstart "Story 1" walkthrough passes; SC-002 (50-change atomic
   commit) verified; SC-005 (conflict surfaces typed) verified for `fail` policy.
5. Tag `v0.1.0-mvp` and demo.

### Incremental Delivery

1. Setup + Foundational → Foundation ready.
2. US1 → Test independently → Demo (MVP).
3. US2 → Test independently → Demo (full single-writer CRUD/commit loop).
4. US3 → Test independently → Demo (rollback safety net).
5. US4 → Test independently → Demo (programmatic provisioning).
6. US5 → Test independently → Demo (reactivity hook).
7. Polish → Tag `v0.1.0` and publish to npm.

Each story adds value without breaking the previous stories.

### Parallel Team Strategy

With multiple developers, after Phase 2 (Foundational) merges:

- Developer A: User Story 1 (commit pipeline, the deepest module).
- Developer B: User Story 2 (CRUD reads + updates).
- Developer C: User Story 3 (rollback) — short.
- Developer D: User Story 4 (repo creation) — short.
- Developer E: User Story 5 (webhooks) — short.

All five can ship independently; Polish phase integrates and validates.

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks in the same phase.
- `[Story]` label maps each user-story task to its priority story for traceability and selective
  demo / MVP scoping.
- Each user story is independently completable and testable — the GhDb class is a facade that
  delegates to per-story modules, so wiring each method into `src/core/gh-db.ts` is the only
  shared file across stories (each story's last task).
- Constitution Principle I requires sibling unit tests under `tests/unit/` for every module
  under `src/` covering the success path and at least one failure case. Tests must be written
  and made to fail before the matching implementation is marked complete.
- Constitution Principle III requires JSDoc on every exported symbol; `eslint-plugin-jsdoc` in
  the CI lint job enforces this.
- Commit after each task or logical group; stop at any checkpoint to validate the story
  independently.
