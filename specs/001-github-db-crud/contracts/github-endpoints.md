# Contract: GitHub REST Endpoints

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

This document enumerates every GitHub REST endpoint `gh-db` calls. The
implementation is free to upgrade Octokit's per-endpoint helpers
(e.g. `octokit.repos.createInOrg`) so long as the underlying HTTP
contract matches the rows below. Tests under
`tests/contract/github-rest-shape.test.ts` lock the endpoints in.

All endpoints support `baseUrl` override (FR-002a). All endpoints are
subject to the gh-db retry layer (FR-027 / FR-028).

---

## Repository provisioning

| Method | Path | Used by | Notes |
|---|---|---|---|
| `POST` | `/user/repos` | `createRepository` when no `organization` is supplied | Authed user becomes the owner. |
| `POST` | `/orgs/{org}/repos` | `createRepository` when `organization` is supplied | Token must have admin scope on the org. |

Request body MUST include at least `name` and `private` (the `visibility`
input is mapped to `private: true`/`false`). The created repository
MUST be initialized with `auto_init: true` so an initial commit and
default branch exist immediately (Story 4 acceptance scenario 1).

---

## Branch / ref reads

| Method | Path | Used by |
|---|---|---|
| `GET` | `/repos/{owner}/{repo}` | initial branch resolution (default branch lookup, only if `config.branch` is omitted) |
| `GET` | `/repos/{owner}/{repo}/git/refs/heads/{branch}` | refresh / read-tip operations under `fresh` and on commit start |

---

## CRUD on JSON records (via Git Data API)

`gh-db` does NOT use the Contents API (`GET/PUT /repos/.../contents/...`)
for writes because that API is per-file. It uses the Contents API only
for the *read* path because it returns the blob content directly.

| Method | Path | Used by | Notes |
|---|---|---|---|
| `GET` | `/repos/{owner}/{repo}/contents/{key}.json` with `?ref={branch or sha}` | `retrieve` | Returns base64-encoded content; gh-db decodes and JSON-parses. |
| `POST` | `/repos/{owner}/{repo}/git/blobs` | `commit` (one call per staged create/update) | Body: `{ content: <utf8-json>, encoding: 'utf-8' }`. |
| `POST` | `/repos/{owner}/{repo}/git/trees` | `commit` | Body: `{ base_tree: <baselineTreeSha>, tree: [...] }` where deletes set `sha: null`. |
| `POST` | `/repos/{owner}/{repo}/git/commits` | `commit` | Body: `{ message, tree, parents: [baselineSha] }`. |
| `PATCH` | `/repos/{owner}/{repo}/git/refs/heads/{branch}` | `commit` (final step), `rollback` | Body: `{ sha, force }`. `force=false` for commit (conflict detection); `force=true` for rollback. |
| `GET` | `/repos/{owner}/{repo}/git/commits/{sha}` | `rollback` (to read `parents[0]`) | |
| `GET` | `/repos/{owner}/{repo}/compare/{base}...{head}` | `commit` under `rebase` policy | Reads `files[].filename` for overlap detection. |

---

## Webhooks

| Method | Path | Used by |
|---|---|---|
| `POST` | `/repos/{owner}/{repo}/hooks` | `subscribeWebhook` |
| `GET` | `/repos/{owner}/{repo}/hooks` | `listWebhooks` |
| `DELETE` | `/repos/{owner}/{repo}/hooks/{hook_id}` | `unsubscribeWebhook` |

Request body for `POST /hooks`:

```json
{
  "name": "web",
  "active": true,
  "events": ["push"],
  "config": { "url": "https://example.com/callback", "content_type": "json" }
}
```

`content_type: "json"` is gh-db's default; an internal-only escape hatch
(not part of the public API in v1) can override it for advanced users.

---

## Headers sent on every request

| Header | Value | Source |
|---|---|---|
| `Authorization` | `Bearer {token}` | `config.auth` |
| `Accept` | `application/vnd.github+json` | gh-db |
| `X-GitHub-Api-Version` | `2022-11-28` | gh-db (pinned; bumped only via a versioned gh-db release) |
| `User-Agent` | `gh-db/<version>` (overridable) | `config.userAgent` |

---

## Headers read on every response

| Header | Read by |
|---|---|
| `Retry-After` | retry layer (primary rate limit) |
| `X-RateLimit-Remaining` | retry layer (secondary rate limit detection) |
| `X-RateLimit-Reset` | retry layer (secondary rate limit reset hint) |
| `ETag` | reserved for future caching; gh-db v1 does not act on it |
