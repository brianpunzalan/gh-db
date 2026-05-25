# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-24

### Added

- `GhDb` class: entry point for using a GitHub repository as a JSON datastore
- **User Story 1** (Create, Stage, Commit): `stageCreate(key, value)`, `listStaged()`, `commit(options)` with atomic multi-file commits via Git Data API
- **User Story 2** (Retrieve, Update, Delete, Reset): `retrieve(key)`, `stageUpdate(key, value)`, `stageDelete(key)`, `reset()`, `refresh()`
- **User Story 3** (Rollback): `rollback()` force-updates the branch tip to the parent commit
- **User Story 4** (Repository Provisioning): `createRepository(options)` provisions a new GitHub repository with `auto_init: true`
- **User Story 5** (Webhooks): `subscribeWebhook(options)`, `listWebhooks()`, `unsubscribeWebhook(id)`
- Conflict policies: `'fail'` (default), `'retry'`, `'rebase'` — configurable per-instance and per-commit
- Read-consistency policies: `'fresh'` (default), `'cached'` with explicit `refresh()`
- Typed error hierarchy: `GhDbError` base with 14 subclasses (`AuthError`, `PermissionError`, `NotFoundError`, `ValidationError`, `ConflictError`, `RateLimitError`, `ServerError`, `NetworkError`, `ParseError`, `SerializationError`, `KeyValidationError`, `RetryExhaustedError`, `StagingError`, `RollbackError`)
- Bounded exponential backoff with full jitter for transient errors (rate-limit, 5xx, network)
- `Retry-After` / `X-RateLimit-Reset` header honoring during retry
- GitHub Enterprise support via `baseUrl` configuration
- In-memory staging area with operation collapse rules (create+delete cancels, update+update keeps last, etc.)
- Dual ESM + CJS build output via tsup
- CI workflow (GitHub Actions) running tests, lint, and format checks on Node 18 and 20
- Full TypeScript type exports for IDE completion and compile-time safety
