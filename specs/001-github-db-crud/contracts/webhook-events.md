# Contract: Webhook Event Identifiers

**Feature**: gh-db — GitHub as a Persistent Data Store
**Branch**: `001-github-db-crud`
**Date**: 2026-05-21

## Caller-supplied event types

The `events` array passed to `subscribeWebhook` is forwarded verbatim to
GitHub. `gh-db` does not maintain a local catalog of valid event names
in v1 — GitHub adds new event types over time and any local list would
date the package. Unknown event names surface as
`ValidationError { subcode: 'invalid_event' }` after GitHub rejects them.

The only client-side validation `gh-db` performs is:

- `events` must be an array (not `undefined`, not a string).
- `events.length >= 1` (FR-023's "list of event types" implies at least one).
- Every element is a non-empty string.

Violations surface as `ValidationError { subcode: 'invalid_input' }`
before the API call is made.

## Documented examples for the README

For onboarding ergonomics, the README (delivered as part of this
feature) MUST include a non-exhaustive table of common event types
with one-line descriptions:

| Event | Triggers on |
|---|---|
| `push` | Any push to any branch in the repository. |
| `pull_request` | PR opened, closed, reopened, edited, etc. |
| `create` | Branch or tag created. |
| `delete` | Branch or tag deleted. |
| `issues` | Issue opened/closed/edited. |
| `release` | Release published / edited. |
| `repository` | Repository-level events (rename, transfer, etc.). |
| `*` | All events (GitHub's wildcard). |

This list is documentation only. `gh-db` does not validate against it.

## Out of scope for v1

- Receiving and verifying webhook payload signatures.
- Persisting webhook deliveries.
- Replaying deliveries.

`gh-db`'s responsibility ends at registering / listing / removing the
hook on GitHub.
