# Feature Specification: gh-db — GitHub as a Persistent Data Store

**Feature Branch**: `001-github-db-crud`

**Created**: 2026-05-20

**Status**: Draft

**Input**: User description: "gh-db is a typescript npm package that allows your client application to interface with Github as a backend data store / database. Github has repositories and repositories can store files that can be committed. I want to use these functions to store JSON data as persistent data. gh-db should be able to do CRUD (create, retrieve, update, delete) files. All CRUD changes should be staged and can only be committed once commit trigger. Can also rollback by checking out to previous commit. basically, can create repository; can CRUD files within repository; can stage changes; stage changes can be committed or reset; can rollback which is just checking out to previous commit (pruning the current commit node and checks out to previous commit node); can subscribe to webhooks for a repository"

## Clarifications

### Session 2026-05-20

- Q: How should JSON records be addressed within the repository (path/identity rules)? → A: Flat single-segment keys only (no slashes), no extension required.
- Q: What should happen on commit when the remote branch tip has advanced beyond the tip seen at staging time (concurrent external commit)? → A: Caller-supplied policy per instance or per commit — `fail` (default), `retry` (refetch tip and replay), or `rebase` (replay only when no staged key overlaps with externally-changed records, otherwise surface conflict).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create, Stage, Commit JSON Records (Priority: P1)

A developer wires gh-db into their application to persist application state (e.g., user profiles, settings, app documents) as JSON files inside a GitHub repository. They create one or more JSON records in memory using gh-db, the changes accumulate as a staged batch, and a single explicit commit call writes them all to the repository as one commit with a chosen message.

**Why this priority**: This is the foundational write path. Without the ability to create a JSON record, stage it, and durably commit it, gh-db delivers no value. Every other capability builds on this loop.

**Independent Test**: With access to a GitHub account and personal access token, the developer can (a) point gh-db at an existing repository, (b) create three JSON records via the API, (c) inspect the staged-changes view and see all three pending, (d) call commit with a message, and (e) verify on github.com that exactly one new commit exists containing the three files with the expected JSON content.

**Acceptance Scenarios**:

1. **Given** a configured gh-db instance pointing at an empty repository, **When** the developer creates two JSON records and calls commit, **Then** exactly one new commit appears on the target branch containing both files with the exact JSON contents provided.
2. **Given** three staged create operations, **When** the developer inspects the pending staged changes before committing, **Then** all three operations are listed with their target paths and operation type.
3. **Given** staged changes exist, **When** the developer calls commit without providing a message, **Then** the operation is rejected with a clear error and the staged changes remain intact.
4. **Given** a commit has just succeeded, **When** the developer inspects staged changes, **Then** the staging area is empty.

---

### User Story 2 - Retrieve and Update Existing Records (Priority: P1)

After data exists in the repository, the application reads JSON records by path, modifies them in memory, and stages updates. Updates are batched alongside creates and deletes and all are released together on commit. The developer can also reset (discard) all staged changes without committing.

**Why this priority**: A datastore that can only write once is not useful. Read and update close the loop for typical application data flows (load, mutate, save). Reset is the natural escape hatch when the user abandons an edit session.

**Independent Test**: After Story 1 has populated the repo, the developer can (a) read a record by its path and receive the JSON object, (b) stage an update that changes one field, (c) stage a delete of another record, (d) call reset, (e) confirm the staging area is empty and the repository is unchanged, then (f) re-stage the same operations and commit and see exactly the expected resulting file set.

**Acceptance Scenarios**:

1. **Given** a record exists at a known path, **When** the developer retrieves it, **Then** the returned value equals the JSON content stored at that path on the current branch.
2. **Given** a non-existent path, **When** the developer attempts to retrieve it, **Then** gh-db reports a "not found" result distinguishable from other errors.
3. **Given** a record exists and the developer stages an update with new JSON content, **When** commit is called, **Then** the resulting commit replaces the file's content and no other files change.
4. **Given** mixed staged operations (one create, one update, one delete), **When** the developer calls reset, **Then** the staging area becomes empty and the repository is unchanged.
5. **Given** a staged update to a path, **When** the developer stages a second update to the same path before committing, **Then** the second value supersedes the first and only one change for that path is committed.

---

### User Story 3 - Rollback to Previous Commit (Priority: P2)

A developer realizes the latest commit was wrong (bad data, accidental delete, regression). They invoke rollback to undo the most recent commit, returning the working state of the branch to the commit immediately before it. Subsequent reads then reflect the pre-rollback state.

**Why this priority**: Rollback is a critical safety net for a write-heavy datastore, but the system is still usable without it (the developer could manually commit corrective data). It sits below the core CRUD loop in priority but is the next most valuable capability.

**Independent Test**: After Stories 1 and 2, the developer can (a) note the current commit identifier, (b) make and commit a change, (c) call rollback, (d) verify the branch tip is the previously-noted commit, and (e) read the affected file and see the pre-rollback value.

**Acceptance Scenarios**:

1. **Given** a branch with at least two commits, **When** the developer calls rollback, **Then** the branch tip moves to the commit that was the parent of the previous tip and any reads reflect that earlier state.
2. **Given** a branch with only one commit (the initial commit), **When** the developer calls rollback, **Then** the operation is rejected with a clear "no prior commit" error and the branch is unchanged.
3. **Given** uncommitted staged changes exist, **When** the developer calls rollback, **Then** gh-db requires the staging area to be empty (or explicitly discarded) before proceeding so that pending work is not silently lost.
4. **Given** a rollback has just succeeded, **When** the developer reads a record that was modified by the rolled-back commit, **Then** the returned value matches the value from before that commit.

---

### User Story 4 - Provision a New Repository (Priority: P2)

A developer onboarding a new application instance asks gh-db to create the backing repository on GitHub. The repository is created under the configured account or organization with sensible defaults (visibility, default branch) and is immediately usable as a gh-db target for the operations in Stories 1–3.

**Why this priority**: Convenient but not essential — a developer could create the repository manually via the GitHub UI and point gh-db at it. Automating this removes a setup step and enables fully programmatic provisioning.

**Independent Test**: The developer calls the create-repository function with a name and visibility, then immediately uses the returned handle to stage and commit a JSON record, and confirms on github.com that the repository exists with that file.

**Acceptance Scenarios**:

1. **Given** valid credentials with repo-creation permission and a unique repository name, **When** the developer requests creation, **Then** the repository exists on GitHub with the requested name, visibility, and a default branch initialized with an empty commit.
2. **Given** a repository with the requested name already exists, **When** the developer requests creation, **Then** gh-db returns a clear "already exists" error and does not modify the existing repository.
3. **Given** credentials lacking repo-creation permission, **When** the developer requests creation, **Then** gh-db returns a clear permission error and no repository is created.

---

### User Story 5 - Subscribe to Repository Webhooks (Priority: P3)

A developer wants the application to react to external changes to the repository (e.g., a teammate edited a file directly on github.com, an automated job pushed a commit). They use gh-db to register a webhook on the repository pointing at the application's callback URL and to list or remove the webhooks gh-db has registered.

**Why this priority**: Reactivity is valuable for collaborative or multi-writer scenarios but is not required for a single-writer application that owns its data exclusively. The core CRUD/commit/rollback loop delivers value independently.

**Independent Test**: The developer subscribes a webhook with a callback URL and selected event types, makes a commit via gh-db, and verifies the callback URL receives a webhook payload for that event. They then list registered webhooks, see the new entry, and unsubscribe it, confirming no further webhooks are delivered.

**Acceptance Scenarios**:

1. **Given** a valid callback URL and selected event types, **When** the developer subscribes, **Then** GitHub records a webhook on the repository for those events and a subsequent matching event causes a delivery to the callback URL.
2. **Given** a subscription has been registered through gh-db, **When** the developer lists subscriptions, **Then** the registered webhook is included with its callback URL and event types.
3. **Given** an existing subscription, **When** the developer unsubscribes it, **Then** the webhook is removed from the repository and no further deliveries occur.
4. **Given** GitHub fails to deliver a webhook (callback returned an error), **When** the developer inspects delivery state, **Then** gh-db surfaces GitHub's recorded delivery status so the developer can diagnose.

---

### Edge Cases

- **Concurrent external commit during staging**: Another actor pushes a commit to the same branch while the developer has staged changes locally. Behavior on commit follows the caller's selected conflict policy (`fail` / `retry` / `rebase` — see FR-022a). gh-db MUST NOT silently overwrite the external commit under any policy.
- **Stage a create at a key that already exists** (or update at a key that does not exist): gh-db must distinguish create-versus-update semantics clearly and reject mismatches with an explicit error rather than silently doing the other operation.
- **Stage a delete of a key that has a pending create in the same staging batch**: The two operations cancel and the key is left untouched; the resulting commit (if anything else is staged) contains no entry for that key.
- **Invalid key supplied** (empty string, contains `/` or `\`, contains path-traversal segments): the operation is rejected before entering the staging area, with a clear validation error distinct from "not found".
- **Invalid JSON content**: Attempting to stage non-JSON-serializable content (functions, circular references) is rejected before staging completes.
- **Very large records**: A single record approaching or exceeding the repository's per-file size limit must surface a clear, actionable error rather than a generic API failure.
- **Many records in one commit**: A single commit batching hundreds of staged changes must complete or fail atomically — partial commits (some files written, others not) are not acceptable.
- **Rate limiting**: GitHub API rate limits must surface as a recognisable error with information about when retry is permitted.
- **Authentication expiry**: A token that expires mid-session yields a clear authentication error on the next operation rather than a confusing generic failure.
- **Rollback when current tip is a merge commit**: Behaviour follows the same "move tip to immediate prior commit" rule; the developer is responsible for understanding the resulting state.
- **Webhook callback URL becomes unreachable**: gh-db's responsibility ends at registering the webhook; delivery failures are visible via GitHub's delivery records but gh-db does not retry on the developer's behalf.

## Requirements *(mandatory)*

### Functional Requirements

#### Configuration & Authentication

- **FR-001**: The package MUST accept credentials (a GitHub access token) and a target repository identifier (owner + repository name) at initialization, and use them for all subsequent operations on that instance.
- **FR-002**: The package MUST allow the caller to specify which branch within the repository serves as the working branch for reads, writes, commits, and rollback; if unspecified, it MUST default to the repository's default branch.

#### Repository Provisioning

- **FR-003**: The package MUST be able to create a new GitHub repository under the configured account or organization, accepting at minimum a name and a visibility setting (public or private).
- **FR-004**: When repository creation fails because a repository of that name already exists, the package MUST report this distinctly from other failures and MUST NOT modify the existing repository.

#### CRUD on JSON Records

- **FR-005**: The package MUST allow the caller to create a new JSON record under a specified **key** within the repository, accepting any JSON-serializable value as content. A key is a single flat identifier (no slashes, no path segments) — records are stored at the top level of the repository's working branch, with no nested directories.
- **FR-005a**: The package MUST validate keys before any operation enters the staging area: a key MUST be a non-empty string that contains no slash (`/`) or backslash (`\`) characters and no path-traversal segments. Keys that fail validation MUST be rejected with a clear error distinct from "not found" or content-serialization errors.
- **FR-005b**: The package MUST NOT require the caller to supply a file extension on the key. The on-repository file name used to persist a record is an internal detail of gh-db; callers address records solely by their key.
- **FR-006**: The package MUST allow the caller to retrieve the JSON content of a record by key, returning the parsed JSON value, and MUST distinguish "not found" from other failure modes.
- **FR-007**: The package MUST allow the caller to update an existing JSON record by key with new JSON content.
- **FR-008**: The package MUST allow the caller to delete a record by key.
- **FR-009**: The package MUST reject create/update operations whose content cannot be serialized as JSON, with a clear error, before that operation enters the staging area.

#### Staging, Commit, and Reset

- **FR-010**: All create, update, and delete operations MUST accumulate in an in-memory staging area and MUST NOT be visible to other clients of the repository until a commit is performed.
- **FR-011**: The package MUST expose a way for the caller to inspect the current contents of the staging area, listing each pending operation's path and operation type (create / update / delete).
- **FR-012**: The package MUST provide a commit operation that, given a commit message, atomically applies all staged operations as a single commit on the working branch and clears the staging area on success.
- **FR-013**: If the commit operation fails for any reason, the staging area MUST remain intact and unchanged so the caller can retry or reset.
- **FR-014**: The package MUST require a non-empty commit message when committing.
- **FR-015**: The package MUST provide a reset operation that discards all staged changes without contacting GitHub and leaves the repository unchanged.
- **FR-016**: When the caller stages multiple operations targeting the same path within one staging batch, the package MUST collapse them to a single net effect at commit time (e.g., create+delete cancels; multiple updates keep the last; create+update collapses to a single create of the final value).
- **FR-017**: Reads (retrieve operations) MUST reflect the staged-but-uncommitted state when staged changes exist for the queried path, so the caller observes a consistent view of their own pending edits. Reads for paths with no staged changes MUST return the latest committed state on the working branch.

#### Rollback

- **FR-018**: The package MUST provide a rollback operation that moves the working branch's tip to the commit immediately preceding the current tip, such that subsequent reads reflect that earlier state.
- **FR-019**: The rollback operation MUST refuse to proceed when the current tip is the branch's initial commit and MUST report this distinctly.
- **FR-020**: The rollback operation MUST refuse to proceed when staged changes exist; the caller must explicitly reset (or commit) those staged changes first.
- **FR-021**: Rollback MUST be a single atomic operation from the caller's perspective — either the branch tip moves and the operation reports success, or it does not move and reports failure.

#### Concurrency & External Changes

- **FR-022**: When committing, the package MUST detect that the remote branch tip has advanced beyond the tip seen when staging began, and MUST never silently overwrite external changes.
- **FR-022a**: The package MUST accept a caller-supplied conflict policy, settable on the instance and overridable per-commit, with three values:
  - **`fail`** (default): surface a typed conflict error and leave the staging area intact for the caller to refresh and retry explicitly.
  - **`retry`**: refetch the latest tip and replay the staged batch on top, applying the same staged operations as if the new tip had been the staging baseline; if the conflict persists across a bounded number of attempts (caller-configurable, with a built-in upper limit), surface a typed conflict error.
  - **`rebase`**: refetch the latest tip; if no staged key intersects the set of keys changed by external commits since the staging baseline, replay the staged batch on top (same behavior as `retry`); if any staged key overlaps with an externally-changed key, surface a typed conflict error identifying the overlapping keys, with the staging area left intact.
- **FR-022b**: In all conflict outcomes (any policy), if the commit ultimately fails, the staging area MUST remain intact (per FR-013) so the caller can inspect, reset, or retry.

#### Webhooks

- **FR-023**: The package MUST allow the caller to register a webhook on the configured repository, accepting a callback URL and a list of event types to subscribe to.
- **FR-024**: The package MUST allow the caller to list webhooks currently registered on the repository.
- **FR-025**: The package MUST allow the caller to unsubscribe (remove) a previously registered webhook by its identifier.

#### Errors & Observability

- **FR-026**: All failures from GitHub (authentication, permission, rate limit, not found, conflict) MUST be surfaced to the caller as distinct, programmatically distinguishable error categories rather than as a single generic error.

### Key Entities *(include if feature involves data)*

- **Repository Handle**: The configured target of an instance — identifies the GitHub owner, repository name, and the working branch. The unit on which all CRUD, commit, rollback, and webhook operations are performed.
- **JSON Record**: A single file stored at the top level of the repository's working branch whose content is a JSON-serializable value. Identified by a flat **key** (a single string with no slashes and no path segments). The atomic unit of read and write.
- **Staging Area**: An in-memory, per-instance set of pending create/update/delete operations against records, awaiting a commit or a reset. Not visible to other clients of the repository.
- **Commit**: A single durable revision of the repository's state, produced by applying all staged operations together with a message. The unit of rollback.
- **Webhook Subscription**: A registration on the repository associating a callback URL with one or more event types; identified by an identifier returned by GitHub at registration time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer integrating gh-db for the first time can go from installing the package to committing their first JSON record in under 15 minutes, given they already have a GitHub access token.
- **SC-002**: A batch of up to 50 staged JSON-record changes can be committed in a single operation that either fully succeeds or fully fails — across 100 test runs, no run leaves the repository in a partially-applied state.
- **SC-003**: After any commit, calling retrieve on each affected path returns the just-committed value in 100% of cases (read-your-writes consistency on the working branch).
- **SC-004**: After a rollback, calling retrieve on any path modified by the rolled-back commit returns the pre-rollback value in 100% of cases.
- **SC-005**: When a commit conflicts with an external commit on the same branch, the caller receives a recognisable conflict error and the staging area remains intact (verified across 100% of conflict test cases).
- **SC-006**: Every distinct failure category from GitHub (authentication, permission, rate limit, not found, conflict, validation) maps to a programmatically distinguishable error in gh-db — verified by an error-coverage matrix across all CRUD, commit, rollback, repo-create, and webhook operations.
- **SC-007**: A webhook registered via gh-db delivers to its callback URL within 30 seconds of a gh-db commit, for at least 95% of deliveries under nominal GitHub conditions.

## Assumptions

- **Single-writer mental model**: gh-db is designed for an application that primarily owns its repository as a datastore. Multi-writer scenarios are supported via conflict detection on commit and webhooks for change notification, but full collaborative merge resolution is the caller's responsibility.
- **Authentication via personal access token (or equivalent)**: The caller supplies a GitHub token with the scopes appropriate for the operations they intend to use (`repo` for CRUD/commit/rollback, repository administration for repository creation and webhook management). gh-db does not implement OAuth flows itself.
- **JSON-only payloads**: Records are JSON values. Binary blobs and non-JSON text formats are out of scope for v1.
- **In-memory staging, per instance**: The staging area lives in the gh-db instance in the host process. It does not persist across process restarts; restarting the application discards uncommitted staged changes.
- **Rollback granularity is one commit at a time**: A single rollback call moves the tip back by exactly one commit. Multi-step rollback is achieved by repeated calls.
- **Rollback semantics are "branch tip reset to parent"**: The previous commit is removed from the branch's history (analogous to a non-fast-forward reset). The caller accepts the implications of rewriting branch history, including on any external clones.
- **Default branch is configurable but defaults to the repository's default**: If the caller does not specify a working branch, gh-db uses the GitHub-reported default branch (typically `main`).
- **Webhook delivery and retry are GitHub's responsibility**: gh-db registers, lists, and removes webhooks but does not proxy, retry, or persist webhook deliveries on the caller's behalf.
- **Reasonable file/repo limits inherited from GitHub**: gh-db inherits GitHub's per-file size limits and per-repository soft limits; these are not re-implemented or worked around in v1.
- **Node.js runtime**: As a TypeScript npm package, gh-db is consumed in a Node.js (or compatible) runtime by client applications; browser-direct usage is not a v1 requirement (and would carry token-exposure risks the caller should manage).
