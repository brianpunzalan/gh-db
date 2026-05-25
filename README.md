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

## License

MIT
