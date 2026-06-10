# gh-db

Use a GitHub repository as a persistent JSON datastore from Node.js.

## Overview

`gh-db` is a TypeScript npm package that lets a Node.js client application
persist JSON records into a GitHub repository as the source of truth. CRUD
operations are staged in memory and applied as a single atomic commit on
the working branch.

## Installation

```sh
npm install gh-db
```

## Quickstart

See [`specs/001-github-db-crud/quickstart.md`](specs/001-github-db-crud/quickstart.md)
for the full Stories 1–5 walkthrough. The condensed version:

```js
import { GhDb } from 'gh-db';

const db = new GhDb({
  owner: process.env.GH_DB_OWNER,
  repo: process.env.GH_DB_REPO,
  auth: process.env.GH_DB_TOKEN,
});

await db.stageCreate('alice', { name: 'Alice', role: 'admin' });
await db.commit({ message: 'add alice' });
```

## Configuration

See `GhDbConfig` in the API reference. Key options:

- `owner`, `repo`, `auth` — required.
- `branch` — defaults to the repo's default branch.
- `baseUrl` — defaults to `https://api.github.com`; set this for
  GitHub Enterprise.
- `conflictPolicy` — `'fail'` (default) | `'retry'` | `'rebase'`.
- `readConsistency` — `'fresh'` (default) | `'cached'`.

## API

Surface exported from `gh-db`:

- `class GhDb` — main entry point.
- Types: `GhDbConfig`, `CommitOptions`, `CommitResult`,
  `StagedOperation`, `StagedOperationKind`, `ConflictPolicy`,
  `ReadConsistencyPolicy`, `RetrieveResult`, `CreateRepositoryOptions`,
  `CreateRepositoryResult`, `WebhookSubscriptionOptions`,
  `WebhookSubscription`, `JsonValue`.
- Errors: `GhDbError` (base) and subclasses `AuthError`,
  `PermissionError`, `NotFoundError`, `ValidationError`,
  `ConflictError`, `RateLimitError`, `ServerError`, `NetworkError`,
  `ParseError`, `SerializationError`, `KeyValidationError`,
  `RetryExhaustedError`, `StagingError`, `RollbackError`.
- `GhDbErrorCode` literal union for discriminated narrowing.

Full JSDoc reference is shipped alongside the compiled output and visible
to consumers via TypeScript / IDE tooling.

## Errors

Every gh-db error extends `GhDbError` and carries a `code` discriminator.
Pattern:

```js
import { GhDb, ConflictError, RetryExhaustedError } from 'gh-db';

try {
  await db.commit({ message: 'risky' });
} catch (err) {
  if (err instanceof ConflictError) {
    /* handle conflict */
  } else if (err instanceof RetryExhaustedError) {
    /* handle exhausted retries */
  } else {
    throw err;
  }
}
```

## Webhooks

Register, list, and remove webhooks on the configured repository:

```js
const hook = await db.subscribeWebhook({
  callbackUrl: 'https://example.com/hook',
  events: ['push'],
});
await db.listWebhooks();
await db.unsubscribeWebhook(hook.id);
```

## GitHub Enterprise

Pass `baseUrl` to target GitHub Enterprise Server / Enterprise Cloud
with a custom domain. The value is forwarded verbatim to Octokit
(typically including the `/api/v3` suffix for GHES).

## Development

```sh
npm install
npm run build
npm run lint
npm run format:check
npm test
```

See the project constitution at `.specify/memory/constitution.md` for
contribution rules.

## Releasing

Releases to the [NPM registry](https://www.npmjs.com/package/gh-db) are fully
automated via [changesets](https://github.com/changesets/changesets) and the
`.github/workflows/release.yml` GitHub Actions workflow. On every push to
`main`, the pipeline:

1. Generates a changeset from the [Conventional Commits](https://www.conventionalcommits.org/)
   since the last release tag (`scripts/generate-changeset.cjs`). The semver
   bump is derived from commit prefixes:
   - `feat!:` / `fix!:` or a `BREAKING CHANGE:` footer → **major**
   - `feat:` → **minor**
   - `fix:` / `perf:` / `refactor:` / anything else → **patch**

   If there are no releasable commits, the workflow exits without publishing.

2. Runs the quality gates (`typecheck`, `lint`, `test`).
3. Applies the version bump with `changeset version` and stamps `CHANGELOG.md`
   with the new version (`scripts/stamp-changelog-version.cjs`).
4. Builds the package and publishes it with `changeset publish`, including
   [npm provenance](https://docs.npmjs.com/generating-provenance-statements).
5. Commits the version bump and pushes the release commit and git tag back to
   `main` (the commit carries `[skip ci]` to avoid a release loop).

### One-time setup

The workflow needs an `NPM_TOKEN` repository secret — an
[npm automation/granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)
with publish rights for the `gh-db` package. Add it under
**Settings → Secrets and variables → Actions**. The built-in `GITHUB_TOKEN`
handles pushing the version commit and tag.

## License

MIT
