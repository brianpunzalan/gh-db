# Implementation Plan: gh-db — GitHub as a Persistent Data Store

**Branch**: `001-github-db-crud` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-github-db-crud/spec.md`

**Note**: This plan was filled in by the `/speckit-plan` command following `.specify/templates/plan-template.md`.

## Summary

`gh-db` is a TypeScript npm package that lets a Node.js client application use a
GitHub repository as a persistent JSON datastore. The package exposes a single
configurable instance class that authenticates with a GitHub personal access
token (against `github.com` or a caller-supplied GitHub Enterprise base URL) and
provides:

- CRUD operations on JSON records identified by flat keys (no slashes, no path
  segments) stored at the top level of a working branch.
- An in-memory, per-instance staging area that accumulates create/update/delete
  operations and collapses repeated operations on the same key to a single net
  effect.
- A `commit` operation that atomically applies the staged batch as a single
  GitHub commit using the Git Data API (blobs → tree → commit → fast-forward
  ref update), with a caller-selectable conflict policy (`fail` / `retry` /
  `rebase`).
- A `reset` operation that clears the staging area without contacting GitHub.
- A `rollback` operation that force-updates the working branch tip to the
  parent of the current commit (i.e. removes the most recent commit from
  history), refusing to proceed when the current tip is the initial commit or
  when staged changes exist.
- Caller-selectable read-consistency policy (`fresh` / `cached`) with an
  explicit `refresh` for the cached mode.
- Repository provisioning (create a new repo with a name + visibility) with
  a distinct "already exists" error.
- Webhook subscription / listing / unsubscription on the configured repository.
- Typed error categories (auth, permission, rate limit, not found, conflict,
  validation, parse, serialization, key validation, retry exhausted, server,
  network) and built-in bounded exponential backoff that retries only the
  transient categories (primary rate limit, secondary rate limit, 5xx), honors
  GitHub's `Retry-After` / rate-limit-reset hints, and surfaces a typed
  retry-exhaustion error when the attempt budget is consumed.

Technical approach (chosen in Phase 0):

- Use [`@octokit/rest`](https://github.com/octokit/rest.js) as the GitHub HTTP
  client (official, supports `baseUrl` for GHES, typed, ubiquitous).
- Use the Git Data API endpoints (`/git/blobs`, `/git/trees`, `/git/commits`,
  `/git/refs`) for the commit pipeline so a single commit can carry many
  files atomically, and so the ref update is a single all-or-nothing step
  that fails on stale tip.
- Bundle dual ESM + CJS output with [`tsup`](https://tsup.egoist.dev/) for
  zero-config TypeScript builds.
- Test with [`vitest`](https://vitest.dev/) plus [`nock`](https://github.com/nock/nock)
  for HTTP-level recording / mocking of GitHub API responses.
- Enforce constitution gates in CI: `vitest run`, `eslint` (with
  `@typescript-eslint` + `eslint-plugin-jsdoc`), and `prettier --check`.

## Technical Context

**Language/Version**: TypeScript 5.4+ compiling to ES2022; targeting Node.js
18+ runtime (the first LTS line with stable global `fetch`, which `@octokit/request`
prefers since v9).

**Primary Dependencies**:

- `@octokit/rest` (^21) — GitHub REST API client; supports `baseUrl` for
  GitHub Enterprise Server / Enterprise Cloud and exposes typed responses.
- `@octokit/request-error` — for typed HTTP error inspection (status,
  response headers including `retry-after` and `x-ratelimit-reset`).
- No other runtime dependencies. Stdlib `JSON` handles serialization;
  exponential backoff is implemented in-package (small, focused, easier to
  test deterministically than a third-party retry library).

**Storage**: GitHub repository, accessed via the Git Data API for atomic
multi-file commits (blobs → tree → commit → ref) and the Webhooks API for
subscription management. No local disk persistence — the staging area is
purely in-memory per instance.

**Testing**:

- `vitest` for unit tests (per-module, fast).
- `nock` for HTTP-level GitHub API mocking; recorded fixtures captured from
  the documented API shapes (no live calls in CI).
- Optional opt-in live integration tests (gated on env vars like
  `GH_DB_LIVE_TOKEN`, `GH_DB_LIVE_REPO`) for smoke testing against a real
  throwaway GitHub repository — skipped by default in CI.

**Target Platform**: Node.js 18+ (LTS). Browser-direct usage is not a v1
requirement and is explicitly out of scope (the package ships only Node
build targets and does not bundle a browser entry point).

**Project Type**: TypeScript npm library (single package, single project).

**Performance Goals**:

- A `commit` carrying up to 50 staged changes completes in a single
  GitHub round-trip series (blobs → tree → commit → ref) and surfaces
  atomic success or atomic failure (SC-002).
- `retrieve` round-trip latency is dominated by GitHub API latency;
  no internal blocking work beyond JSON parse.
- Webhook deliveries: registration takes a single API call; gh-db does
  not proxy or buffer deliveries (SC-007 is GitHub's responsibility once
  the hook is registered).

**Constraints**:

- Must support both `github.com` and GitHub Enterprise (Server / Cloud
  with custom domain) via a caller-supplied `baseUrl`.
- Must never silently overwrite an external commit (FR-022).
- Must never persist staged changes outside the instance's process memory
  (FR-010).
- Must classify and surface every distinct GitHub failure category
  programmatically (FR-026, SC-006).
- Must respect GitHub's primary and secondary rate-limit reset hints
  during retries (FR-028).
- TypeScript types must be exported alongside the runtime build so
  consumers get full IDE completion and compile-time safety.

**Scale/Scope**:

- Designed for single-writer applications that own their repository as a
  datastore; multi-writer correctness is delegated to the caller via
  conflict detection on commit (FR-022/022a) and webhook subscription
  for change notification (FR-023..025).
- A commit batches up to ~50 changes comfortably (SC-002); the design
  does not impose a hard upper bound beyond GitHub's own per-tree /
  per-request limits, which are inherited rather than re-implemented.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Verify the following constitution gates for this feature:

- [x] **I. Unit Testing**: Every module under `src/` will have a sibling
  unit test under `tests/unit/` covering the success path and at least
  one failure / edge case. Vitest is configured to fail the build on
  any test failure. See Phase 1 design (`data-model.md`,
  `contracts/`) for the modules whose unit tests are mandated.
- [x] **II. Quality Gates**: CI pipeline (one workflow file in
  `.github/workflows/ci.yml`) runs `vitest run`, `eslint .`, and
  `prettier --check .`. All three are required to pass before merge.
- [x] **III. JSDoc Documentation**: `eslint-plugin-jsdoc` is enabled in
  the ESLint config with `require-jsdoc` on every exported symbol
  (functions, classes, methods, type aliases re-exported from the
  public surface). Phase 1 contracts already include JSDoc-shaped
  signatures so the implementation has a template to follow.
- [x] **IV. Code Intent Comments**: Each logical block of non-trivial
  code (retry loop, conflict resolution, staging collapse rules,
  commit pipeline) MUST carry a leading intent comment explaining
  *why* (the business rule, GitHub-API quirk, or constraint motivating
  the block). Stale intent comments MUST be updated in the same PR
  that changes the code. Reviewer checklist enforces this.
- [x] **V. Semantic Versioning & Changelog**: `package.json` will start
  at version `0.1.0` for the first feature merge. A `CHANGELOG.md`
  entry is included in the task plan (see future `tasks.md`) with
  Keep-a-Changelog headings (`Added`/`Changed`/etc.). The release
  workflow is out of scope for this feature itself but is captured
  as a follow-up on the constitution.

All gates pass; no Complexity Tracking entries are required.

## Project Structure

### Documentation (this feature)

```text
specs/001-github-db-crud/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── public-api.md       # Public TypeScript API surface
│   ├── errors.md           # Typed error hierarchy
│   ├── github-endpoints.md # GitHub REST endpoints the package depends on
│   └── webhook-events.md   # Webhook event-type identifiers the package accepts
├── spec.md              # Feature spec (input to this plan)
├── checklists/
│   └── requirements.md     # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── index.ts                # Public entry point: exports GhDb + types + errors
├── core/
│   ├── gh-db.ts                # GhDb class — instance state + delegation
│   └── instance-config.ts      # Typed config parsing & validation
├── client/
│   ├── octokit-client.ts       # Octokit instance factory (auth + baseUrl + UA)
│   └── http-error.ts           # Maps Octokit RequestError → typed gh-db error
├── crud/
│   ├── create.ts               # stageCreate(key, value)
│   ├── retrieve.ts             # retrieve(key) — staging-aware + read policy
│   ├── update.ts               # stageUpdate(key, value)
│   └── delete.ts               # stageDelete(key)
├── staging/
│   ├── staging-area.ts         # In-memory staging area data structure
│   ├── collapse.ts             # Net-effect rules (create+delete cancels, etc.)
│   └── inspect.ts              # listStaged()
├── commit/
│   ├── pipeline.ts             # blobs → tree → commit → ref update sequence
│   ├── tree-builder.ts         # Compose new tree from base + staged changes
│   └── commit-orchestrator.ts  # Top-level commit() entry; ties in conflict policy
├── conflict/
│   ├── policy.ts               # 'fail' | 'retry' | 'rebase' selectors
│   ├── overlap.ts              # Detects staged-key vs external-changed-key overlap
│   └── rebase.ts               # Replay-on-new-tip helper
├── rollback/
│   └── rollback.ts             # Force-update ref to parent commit SHA
├── repository/
│   └── create-repository.ts    # Create a new GitHub repository
├── webhooks/
│   ├── subscribe.ts            # POST /repos/{owner}/{repo}/hooks
│   ├── list.ts                 # GET /repos/{owner}/{repo}/hooks
│   └── unsubscribe.ts          # DELETE /repos/{owner}/{repo}/hooks/{id}
├── retry/
│   ├── classify.ts             # transient vs non-transient classification
│   ├── backoff.ts              # Exponential backoff with Retry-After honoring
│   └── retry-loop.ts           # Bounded retry executor
├── serialization/
│   ├── encode.ts               # JSON.stringify with circular/non-JSON guard
│   └── decode.ts               # JSON.parse with typed ParseError
├── validation/
│   └── key.ts                  # Key format validation (FR-005a)
├── errors/
│   └── index.ts                # Typed error class hierarchy
└── types/
    └── public.ts               # Public TypeScript types (Config, StagedOp, etc.)

tests/
├── unit/
│   ├── core/
│   ├── client/
│   ├── crud/
│   ├── staging/
│   ├── commit/
│   ├── conflict/
│   ├── rollback/
│   ├── repository/
│   ├── webhooks/
│   ├── retry/
│   ├── serialization/
│   ├── validation/
│   └── errors/
├── contract/
│   ├── github-rest-shape.test.ts   # Recorded fixture shape conformance
│   └── public-api-shape.test.ts    # Verifies index.ts exported surface
└── integration/
    ├── crud-commit-flow.test.ts        # Nock-driven end-to-end of Story 1+2
    ├── rollback-flow.test.ts           # Story 3
    ├── repository-creation-flow.test.ts# Story 4
    ├── webhook-flow.test.ts            # Story 5
    ├── conflict-policy-fail.test.ts
    ├── conflict-policy-retry.test.ts
    └── conflict-policy-rebase.test.ts

# Top-level config
package.json
tsconfig.json
tsup.config.ts
vitest.config.ts
eslint.config.js
.prettierrc
.github/workflows/ci.yml
CHANGELOG.md
README.md
```

**Structure Decision**: Single TypeScript library project (template Option 1
adapted to a library). The `src/` tree groups modules by responsibility
rather than by layer, because each public capability (CRUD, commit,
conflict policy, rollback, webhooks) has distinct GitHub-API and
domain-logic concerns that benefit from being isolated for unit-test
coverage (Constitution I) and JSDoc clarity (Constitution III). Tests
mirror the `src/` layout one-to-one so a reviewer can immediately locate
the test for any module.

## Complexity Tracking

> *Filled only if Constitution Check has violations that must be justified.*

No violations. All five constitution gates pass without exception. No
entries are required in this table.
