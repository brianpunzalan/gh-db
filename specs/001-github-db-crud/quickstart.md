# Quickstart: gh-db

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

This quickstart walks a developer from a fresh checkout to a working
gh-db instance that creates, retrieves, updates, deletes, and commits
JSON records — exercising Stories 1 and 2 end-to-end. Subsequent
sections cover rollback (Story 3), repository creation (Story 4), and
webhooks (Story 5).

The goal of this document is twofold:

1. **Developer onboarding (SC-001)**: A reader should be able to follow
   this to first-commit success in under 15 minutes given an existing
   GitHub token.
2. **Smoke acceptance**: This script doubles as an acceptance harness
   — every step's expected output is precise enough to manually verify
   the implementation matches the spec.

---

## Prerequisites

- Node.js 18 or newer.
- A GitHub personal access token with the `repo` scope (for CRUD /
  commit / rollback). Repository creation also needs `repo` (or the
  appropriate fine-grained equivalent); webhook management needs
  `admin:repo_hook` (or the fine-grained equivalent).
- An existing GitHub repository to use as the datastore, with at
  least one prior commit on the working branch. (If you do not have
  one, skip ahead to "Story 4: Provision a new repository" below.)

Set the following environment variables in your shell:

```sh
export GH_DB_TOKEN="ghp_xxx_your_token_here"
export GH_DB_OWNER="your-github-username-or-org"
export GH_DB_REPO="the-repo-name"
export GH_DB_BRANCH="main"   # optional — defaults to the repo's default branch
```

---

## Install the package

```sh
npm install gh-db
```

---

## Story 1 — Create, stage, and commit JSON records

Create a file `scripts/quickstart.mjs`:

```js
import { GhDb } from 'gh-db';

const db = new GhDb({
  owner: process.env.GH_DB_OWNER,
  repo: process.env.GH_DB_REPO,
  branch: process.env.GH_DB_BRANCH,
  auth: process.env.GH_DB_TOKEN,
});

// Stage three creates.
await db.stageCreate('alice', { name: 'Alice', role: 'admin' });
await db.stageCreate('bob', { name: 'Bob', role: 'editor' });
await db.stageCreate('carol', { name: 'Carol', role: 'viewer' });

// Inspect the pending staged batch.
const staged = db.listStaged();
console.log(`Staged ops: ${staged.length}`); // → 3
for (const op of staged) {
  console.log(`  ${op.kind} ${op.key}`);
}

// Commit them all as a single GitHub commit.
const result = await db.commit({ message: 'add initial users' });
console.log(`Commit SHA: ${result.sha}`);
console.log(`Tree SHA:   ${result.treeSha}`);
console.log(`Parent SHA: ${result.parentSha}`);

// The staging area is empty after a successful commit.
console.log(`Staged after commit: ${db.listStaged().length}`); // → 0
```

Run it:

```sh
node scripts/quickstart.mjs
```

Expected: one new commit on the working branch containing exactly
three files (`alice.json`, `bob.json`, `carol.json`), each holding the
expected JSON payload. Verify on github.com or via `git log` /
`git show <sha>`.

This exercises Story 1 acceptance scenarios 1, 2, and 4. Scenario 3
("commit without a message is rejected") is exercised by changing
`message: ''` and observing a `ValidationError` thrown before any API
call.

---

## Story 2 — Retrieve, update, delete, reset

```js
// Read alice — staging-aware: if a staged change for 'alice' exists,
// that's what we see; otherwise we read the committed value.
const alice = await db.retrieve('alice');
if (alice.found) {
  console.log('alice:', alice.value);
} else {
  console.log('alice not found');
}

// Stage mixed operations.
await db.stageUpdate('alice', { name: 'Alice', role: 'super-admin' });
await db.stageDelete('carol');
await db.stageCreate('dave', { name: 'Dave', role: 'editor' });

console.log('Mixed staged:', db.listStaged().map((o) => `${o.kind} ${o.key}`));
//   [ 'update alice', 'delete carol', 'create dave' ]

// Decide to abandon them all.
db.reset();
console.log('After reset:', db.listStaged().length); // → 0

// Repository is unchanged — confirm by re-reading.
const carol = await db.retrieve('carol');
console.log('carol still present after reset:', carol.found); // → true

// Re-stage and commit for real.
await db.stageUpdate('alice', { name: 'Alice', role: 'super-admin' });
await db.stageDelete('carol');
await db.stageCreate('dave', { name: 'Dave', role: 'editor' });
const result2 = await db.commit({ message: 'promote alice, drop carol, add dave' });
console.log('Second commit SHA:', result2.sha);
```

Expected: a second commit on the branch in which `alice.json`'s role
changed to `'super-admin'`, `carol.json` was removed, and `dave.json`
was added.

This exercises Story 2 acceptance scenarios 1, 2 (try
`db.retrieve('non-existent')` to see `{ found: false }`), 3, 4, and 5
(stage two updates to the same key — only the last persists).

---

## Story 3 — Rollback the most recent commit

```js
// Note the commit just produced.
console.log('Will rollback from:', result2.sha);

// Staging area must be empty before rollback.
await db.rollback();
console.log('Rollback done. Tip moved to parent of', result2.sha);

// Verify by reading alice — should be back to the pre-rollback value.
const aliceAfter = await db.retrieve('alice');
console.log('alice after rollback:', aliceAfter.value);
// → { name: 'Alice', role: 'admin' }   (the value from before the second commit)
```

Expected: after `rollback()`, the working branch tip points to
`result2.parentSha` and `alice.json` is back to its pre-second-commit
state. The most recent commit is gone from the branch history.

Exercises Story 3 acceptance scenarios 1 and 4. Scenarios 2 ("initial
commit") and 3 ("staging non-empty") are exercised by repeatedly
rolling back to the root and by staging an op then trying to roll back,
respectively — both should throw `RollbackError`.

---

## Story 4 — Provision a new repository

If you do not yet have a repository to point gh-db at:

```js
import { GhDb } from 'gh-db';

const bootstrap = new GhDb({
  // For repo creation, owner/repo are placeholders; we only need auth.
  owner: 'placeholder',
  repo: 'placeholder',
  auth: process.env.GH_DB_TOKEN,
});

const created = await bootstrap.createRepository({
  name: 'my-app-data',
  visibility: 'private',
});

console.log('Created:', created.owner + '/' + created.name);
console.log('Default branch:', created.defaultBranch);
console.log('Initial commit:', created.initialCommitSha);

// Now point a real instance at the new repository:
const db = new GhDb({
  owner: created.owner,
  repo: created.name,
  branch: created.defaultBranch,
  auth: process.env.GH_DB_TOKEN,
});

await db.stageCreate('hello', { greeting: 'world' });
await db.commit({ message: 'first record' });
```

Exercises Story 4 acceptance scenario 1. Scenario 2 ("name already
exists") is exercised by re-running the `createRepository` call with
the same name — gh-db throws `ValidationError` with subcode
`'already_exists'`.

---

## Story 5 — Subscribe to webhooks

```js
const hook = await db.subscribeWebhook({
  callbackUrl: 'https://example.com/gh-db-webhook',
  events: ['push'],
});
console.log('Registered hook id:', hook.id);

const all = await db.listWebhooks();
console.log('All hooks on repo:', all.map((h) => h.id));

// Trigger a commit — your callbackUrl will receive a `push` event.
await db.stageCreate('webhook-canary', { ok: true });
await db.commit({ message: 'trigger webhook' });

// When you no longer need it:
await db.unsubscribeWebhook(hook.id);
```

Exercises Story 5 acceptance scenarios 1, 2, and 3.

---

## Conflict policies

Set the policy at instance level or per-commit:

```js
// Instance-level default.
const db = new GhDb({
  owner: '...', repo: '...', auth: '...',
  conflictPolicy: 'retry',
  conflictMaxAttempts: 5,
});

// Override per-commit.
await db.commit({ message: 'tolerant commit', conflictPolicy: 'rebase' });
```

Behavior:

- `fail` (default): if another commit landed since staging began,
  throws `ConflictError` and leaves staging intact.
- `retry`: refetches the new tip and replays the staged batch on top,
  bounded by `conflictMaxAttempts`. On exhaustion throws `ConflictError`.
- `rebase`: same as `retry`, but first checks whether any staged key
  was also changed by the external commits. If yes, throws
  `ConflictError` with `overlappingKeys` set.

---

## Read-consistency

```js
// Refresh tip on every retrieve (default).
const db = new GhDb({ ..., readConsistency: 'fresh' });

// Cache tip; refresh only on commit/rollback/refresh.
const db2 = new GhDb({ ..., readConsistency: 'cached' });

// After receiving an external webhook indicating a push:
await db2.refresh();
```

---

## GitHub Enterprise

```js
const db = new GhDb({
  owner: '...',
  repo: '...',
  auth: process.env.GH_DB_TOKEN,
  baseUrl: 'https://github.enterprise.example.com/api/v3',
});
```

Pass the URL exactly as Octokit expects (typically including the
`/api/v3` suffix for GHES). All gh-db operations route through the
configured base URL.

---

## Error handling pattern

```js
import { GhDb, ConflictError, RetryExhaustedError, RateLimitError } from 'gh-db';

try {
  await db.commit({ message: 'risky' });
} catch (err) {
  if (err instanceof ConflictError) {
    // Someone else committed first. Inspect staging, decide what to do.
    console.error('Conflict at', err.remoteSha, '— overlapping:', err.overlappingKeys);
  } else if (err instanceof RetryExhaustedError) {
    console.error('Gave up after', err.attempts, 'attempts; reset at', err.resetAt);
  } else if (err instanceof RateLimitError) {
    console.error('Rate limited; reset at', err.resetAt);
  } else {
    throw err;
  }
}
```

Or `switch` on `err.code` if you prefer:

```js
switch (err.code) {
  case 'conflict': /* ... */ break;
  case 'retry_exhausted': /* ... */ break;
  case 'rate_limit': /* ... */ break;
  default: throw err;
}
```

---

## Acceptance summary

| Spec story | Quickstart section | Notes |
|---|---|---|
| Story 1 (P1) | "Story 1 — Create, stage, and commit" | Three records, one commit. |
| Story 2 (P1) | "Story 2 — Retrieve, update, delete, reset" | Mixed ops, reset, re-commit. |
| Story 3 (P2) | "Story 3 — Rollback" | Force-update ref to parent. |
| Story 4 (P2) | "Story 4 — Provision a new repository" | `createRepository` + new instance. |
| Story 5 (P3) | "Story 5 — Subscribe to webhooks" | Subscribe/list/unsubscribe. |
| FR-022a policies | "Conflict policies" | `fail` / `retry` / `rebase`. |
| FR-017a / 017b | "Read-consistency" | `fresh` / `cached` + `refresh`. |
| FR-002a | "GitHub Enterprise" | `baseUrl`. |
| FR-026 | "Error handling pattern" | Typed errors. |
