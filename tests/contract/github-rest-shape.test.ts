/**
 * Contract tests: verify that gh-db internal functions call the correct
 * GitHub REST endpoint (method + path), send the right request body shape,
 * and correctly process mock responses.
 *
 * Uses vi.fn() to mock octokit.request — no HTTP is ever issued.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';

import { createRepository } from '../../src/repository/create-repository.js';
import { runCommitPipeline } from '../../src/commit/pipeline.js';
import { retrieveRecord } from '../../src/crud/retrieve.js';
import { runRollback } from '../../src/rollback/rollback.js';
import { replayOnNewTip } from '../../src/conflict/rebase.js';
import { subscribeWebhook } from '../../src/webhooks/subscribe.js';
import { listWebhooks } from '../../src/webhooks/list.js';
import { unsubscribeWebhook } from '../../src/webhooks/unsubscribe.js';
import { StagingArea } from '../../src/staging/staging-area.js';
import { parseInstanceConfig } from '../../src/core/instance-config.js';
import { ConflictError } from '../../src/errors/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock Octokit whose `request` method is the provided
 * vi mock function. Cast is safe because gh-db only uses `octokit.request`.
 */
function makeMockOctokit(
  requestImpl: (route: string, params?: unknown) => Promise<unknown>,
): Octokit {
  return { request: requestImpl } as unknown as Octokit;
}

/** Wrap a data payload in a minimal Octokit response envelope. */
function ok(data: unknown): { data: unknown; status: number } {
  return { data, status: 200 };
}

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const OWNER = 'testowner';
const REPO = 'testrepo';
const BRANCH = 'main';

const BLOB_RESP = { sha: 'blob-sha-abc' };
const TREE_RESP = { sha: 'tree-sha-def' };
const COMMIT_RESP = { sha: 'commit-sha-ghi', tree: { sha: 'tree-sha-def' } };
const REF_RESP = {
  object: { sha: 'tip-sha-123' },
  ref: 'refs/heads/main',
};
const CONTENTS_RESP = {
  content: Buffer.from('{"key":"value"}').toString('base64') + '\n',
  encoding: 'base64',
};
const COMPARE_RESP = { files: [{ filename: 'other-key.json' }] };
const REPO_CREATE_RESP = {
  owner: { login: OWNER },
  default_branch: BRANCH,
};
const HOOK_CREATE_RESP = {
  id: 42,
  active: true,
  events: ['push'],
  config: { url: 'https://example.com/hook' },
};
const HOOK_LIST_RESP = [
  {
    id: 42,
    active: true,
    events: ['push'],
    config: { url: 'https://example.com/hook' },
  },
];

// ---------------------------------------------------------------------------
// 1. Repository provisioning
// ---------------------------------------------------------------------------

describe('POST /user/repos — createRepository without organization', () => {
  it('calls the correct endpoint with name, private, and auto_init', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /user/repos') return Promise.resolve(ok(REPO_CREATE_RESP));
      // Secondary call: ref read after creation (non-critical)
      return Promise.resolve(ok(REF_RESP));
    });
    const octokit = makeMockOctokit(request);

    const result = await createRepository(octokit, {
      name: REPO,
      visibility: 'private',
    });

    // Verify the first call is POST /user/repos
    const [firstRoute, firstParams] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(firstRoute).toBe('POST /user/repos');
    expect(firstParams).toMatchObject({
      name: REPO,
      private: true,
      auto_init: true,
    });

    // Verify the result is mapped correctly
    expect(result.owner).toBe(OWNER);
    expect(result.name).toBe(REPO);
    expect(result.defaultBranch).toBe(BRANCH);
  });

  it('sets private: false for public visibility', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /user/repos') return Promise.resolve(ok(REPO_CREATE_RESP));
      return Promise.resolve(ok(REF_RESP));
    });
    const octokit = makeMockOctokit(request);

    await createRepository(octokit, { name: REPO, visibility: 'public' });

    const [, params] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(params).toMatchObject({ private: false });
  });
});

describe('POST /orgs/{org}/repos — createRepository with organization', () => {
  it('calls the org endpoint with org, name, private, and auto_init', async () => {
    const ORG = 'my-org';
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /orgs/{org}/repos') return Promise.resolve(ok(REPO_CREATE_RESP));
      return Promise.resolve(ok(REF_RESP));
    });
    const octokit = makeMockOctokit(request);

    const result = await createRepository(octokit, {
      name: REPO,
      visibility: 'public',
      organization: ORG,
    });

    const [firstRoute, firstParams] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(firstRoute).toBe('POST /orgs/{org}/repos');
    expect(firstParams).toMatchObject({
      org: ORG,
      name: REPO,
      private: false,
      auto_init: true,
    });

    // Owner comes from the response payload
    expect(result.owner).toBe(OWNER);
    expect(result.defaultBranch).toBe(BRANCH);
  });
});

// ---------------------------------------------------------------------------
// 2. Ref tip read
// ---------------------------------------------------------------------------

describe('GET /repos/{owner}/{repo}/git/ref/{ref} — ref tip read', () => {
  it('retrieveRecord calls the ref endpoint to refresh tip under fresh mode', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}')
        return Promise.resolve(ok(REF_RESP));
      // Contents read
      return Promise.resolve(ok(CONTENTS_RESP));
    });
    const octokit = makeMockOctokit(request);
    const staging = new StagingArea();
    const config = parseInstanceConfig({
      owner: OWNER,
      repo: REPO,
      auth: 'token',
      branch: BRANCH,
      readConsistency: 'fresh',
    });
    const cachedTip = { sha: undefined as string | undefined, treeSha: undefined as string | undefined, observedAt: undefined as Date | undefined };

    await retrieveRecord({ octokit, config, staging, cachedTip, branch: BRANCH }, 'mykey');

    const refCall = request.mock.calls.find(
      ([route]: [string]) => route === 'GET /repos/{owner}/{repo}/git/ref/{ref}',
    );
    expect(refCall).toBeDefined();
    const [, refParams] = refCall as [string, Record<string, unknown>];
    expect(refParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BRANCH}`,
    });

    // The cached tip must be updated
    expect(cachedTip.sha).toBe('tip-sha-123');
  });
});

// ---------------------------------------------------------------------------
// 3. File read (Contents API)
// ---------------------------------------------------------------------------

describe('GET /repos/{owner}/{repo}/contents/{path} — file read for retrieve', () => {
  it('calls contents endpoint with the right path and ref', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}')
        return Promise.resolve(ok(REF_RESP));
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}')
        return Promise.resolve(ok(CONTENTS_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);
    const staging = new StagingArea();
    const config = parseInstanceConfig({
      owner: OWNER,
      repo: REPO,
      auth: 'token',
      branch: BRANCH,
      readConsistency: 'fresh',
    });
    const cachedTip = { sha: undefined as string | undefined, treeSha: undefined as string | undefined, observedAt: undefined as Date | undefined };

    const result = await retrieveRecord(
      { octokit, config, staging, cachedTip, branch: BRANCH },
      'mykey',
    );

    const contentsCall = request.mock.calls.find(
      ([route]: [string]) => route === 'GET /repos/{owner}/{repo}/contents/{path}',
    );
    expect(contentsCall).toBeDefined();
    const [, contentsParams] = contentsCall as [string, Record<string, unknown>];
    expect(contentsParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      path: 'mykey.json',
      ref: 'tip-sha-123',
    });

    // The base64-decoded and JSON-parsed value
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.value).toEqual({ key: 'value' });
    }
  });
});

// ---------------------------------------------------------------------------
// 4-7. Blob, tree, commit, ref-update (commit pipeline)
// ---------------------------------------------------------------------------

describe('commit pipeline: POST blob, POST tree, POST commit, PATCH ref', () => {
  it('calls blob endpoint with content and encoding', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /repos/{owner}/{repo}/git/blobs')
        return Promise.resolve(ok(BLOB_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/trees')
        return Promise.resolve(ok(TREE_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/commits')
        return Promise.resolve(ok(COMMIT_RESP));
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok(REF_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);

    await runCommitPipeline({
      octokit,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      baselineSha: 'baseline-sha',
      baselineTreeSha: 'baseline-tree-sha',
      ops: [{ kind: 'create', key: 'mykey', value: { hello: 'world' }, enqueuedAt: new Date() }],
      message: 'test commit',
    });

    const blobCall = request.mock.calls.find(
      ([route]: [string]) => route === 'POST /repos/{owner}/{repo}/git/blobs',
    );
    expect(blobCall).toBeDefined();
    const [, blobParams] = blobCall as [string, Record<string, unknown>];
    expect(blobParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      encoding: 'utf-8',
    });
    // content must be a string (JSON-serialized)
    expect(typeof blobParams['content']).toBe('string');
  });

  it('calls tree endpoint with base_tree and tree entries', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /repos/{owner}/{repo}/git/blobs')
        return Promise.resolve(ok(BLOB_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/trees')
        return Promise.resolve(ok(TREE_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/commits')
        return Promise.resolve(ok(COMMIT_RESP));
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok(REF_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);

    await runCommitPipeline({
      octokit,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      baselineSha: 'baseline-sha',
      baselineTreeSha: 'baseline-tree-sha',
      ops: [{ kind: 'create', key: 'mykey', value: { hello: 'world' }, enqueuedAt: new Date() }],
      message: 'test commit',
    });

    const treeCall = request.mock.calls.find(
      ([route]: [string]) => route === 'POST /repos/{owner}/{repo}/git/trees',
    );
    expect(treeCall).toBeDefined();
    const [, treeParams] = treeCall as [string, Record<string, unknown>];
    expect(treeParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      base_tree: 'baseline-tree-sha',
    });
    expect(Array.isArray(treeParams['tree'])).toBe(true);
  });

  it('calls commit endpoint with message, tree, and parents', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /repos/{owner}/{repo}/git/blobs')
        return Promise.resolve(ok(BLOB_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/trees')
        return Promise.resolve(ok(TREE_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/commits')
        return Promise.resolve(ok(COMMIT_RESP));
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok(REF_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);

    await runCommitPipeline({
      octokit,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      baselineSha: 'baseline-sha',
      baselineTreeSha: 'baseline-tree-sha',
      ops: [{ kind: 'create', key: 'mykey', value: { hello: 'world' }, enqueuedAt: new Date() }],
      message: 'test commit',
    });

    const commitCall = request.mock.calls.find(
      ([route]: [string]) => route === 'POST /repos/{owner}/{repo}/git/commits',
    );
    expect(commitCall).toBeDefined();
    const [, commitParams] = commitCall as [string, Record<string, unknown>];
    expect(commitParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      message: 'test commit',
      tree: 'tree-sha-def',
      parents: ['baseline-sha'],
    });
  });

  it('calls PATCH ref with force=false for normal commit (ref update)', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      if (route === 'POST /repos/{owner}/{repo}/git/blobs')
        return Promise.resolve(ok(BLOB_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/trees')
        return Promise.resolve(ok(TREE_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/commits')
        return Promise.resolve(ok(COMMIT_RESP));
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok(REF_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);

    const result = await runCommitPipeline({
      octokit,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      baselineSha: 'baseline-sha',
      baselineTreeSha: 'baseline-tree-sha',
      ops: [{ kind: 'create', key: 'mykey', value: { hello: 'world' }, enqueuedAt: new Date() }],
      message: 'test commit',
    });

    const patchCall = request.mock.calls.find(
      ([route]: [string]) => route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}',
    );
    expect(patchCall).toBeDefined();
    const [, patchParams] = patchCall as [string, Record<string, unknown>];
    expect(patchParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BRANCH}`,
      sha: 'commit-sha-ghi',
      force: false,
    });

    // Returned commit sha matches the mock
    expect(result.sha).toBe('commit-sha-ghi');
    expect(result.parentSha).toBe('baseline-sha');
    expect(result.treeSha).toBe('tree-sha-def');
  });
});

// ---------------------------------------------------------------------------
// 8 (rollback): GET commit + PATCH ref with force=true
// ---------------------------------------------------------------------------

describe('rollback: GET commit for parents, PATCH ref with force=true', () => {
  it('calls GET ref then GET commit then PATCH ref with force=true', async () => {
    const request = vi.fn().mockImplementation((route: string) => {
      // Step 1: get current tip via ref
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}')
        return Promise.resolve(ok(REF_RESP));
      // Step 2: get commit to read parent
      if (route === 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}')
        return Promise.resolve(ok({ parents: [{ sha: 'parent-sha' }] }));
      // Step 3: force-update ref
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok({ ref: 'refs/heads/main', object: { sha: 'parent-sha' } }));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);
    const staging = new StagingArea(); // empty — required by rollback
    const config = parseInstanceConfig({
      owner: OWNER,
      repo: REPO,
      auth: 'token',
      branch: BRANCH,
    });
    const cachedTip = { sha: undefined as string | undefined, treeSha: undefined as string | undefined, observedAt: undefined as Date | undefined };

    await runRollback({ octokit, config, staging, cachedTip, branch: BRANCH });

    // Verify GET commit was called with the tip SHA
    const commitGetCall = request.mock.calls.find(
      ([route]: [string]) => route === 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
    );
    expect(commitGetCall).toBeDefined();
    const [, commitGetParams] = commitGetCall as [string, Record<string, unknown>];
    expect(commitGetParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      commit_sha: 'tip-sha-123',
    });

    // Verify PATCH ref with force=true (rollback)
    const patchCall = request.mock.calls.find(
      ([route]: [string]) => route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}',
    );
    expect(patchCall).toBeDefined();
    const [, patchParams] = patchCall as [string, Record<string, unknown>];
    expect(patchParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BRANCH}`,
      sha: 'parent-sha',
      force: true,
    });

    // Cached tip is updated to the rolled-back parent SHA
    expect(cachedTip.sha).toBe('parent-sha');
  });
});

// ---------------------------------------------------------------------------
// 10. Compare endpoint (rebase overlap detection)
// ---------------------------------------------------------------------------

describe('GET /repos/{owner}/{repo}/compare/{base}...{head} — rebase overlap detection', () => {
  it('calls compare endpoint with correct basehead when checkOverlap is true', async () => {
    const BASELINE = 'baseline-sha-001';
    const REMOTE = 'remote-sha-002';

    const request = vi.fn().mockImplementation((route: string) => {
      // replayOnNewTip first fetches the ref tip
      if (route === 'GET /repos/{owner}/{repo}/git/ref/{ref}') {
        return Promise.resolve(ok({ object: { sha: REMOTE }, ref: 'refs/heads/main' }));
      }
      // Then fetches the commit for tree sha
      if (route === 'GET /repos/{owner}/{repo}/git/commits/{commit_sha}') {
        return Promise.resolve(ok({ tree: { sha: 'remote-tree-sha' }, parents: [] }));
      }
      // Compare endpoint
      if (route === 'GET /repos/{owner}/{repo}/compare/{basehead}') {
        return Promise.resolve(ok(COMPARE_RESP));
      }
      // Blob, tree, commit, ref for the replayed pipeline
      if (route === 'POST /repos/{owner}/{repo}/git/blobs') {
        return Promise.resolve(ok(BLOB_RESP));
      }
      if (route === 'POST /repos/{owner}/{repo}/git/trees')
        return Promise.resolve(ok(TREE_RESP));
      if (route === 'POST /repos/{owner}/{repo}/git/commits')
        return Promise.resolve(ok(COMMIT_RESP));
      if (route === 'PATCH /repos/{owner}/{repo}/git/refs/{ref}')
        return Promise.resolve(ok(REF_RESP));
      return Promise.reject(new Error(`Unexpected route: ${route}`));
    });
    const octokit = makeMockOctokit(request);

    const conflict = new ConflictError('branch tip advanced', {
      baselineSha: BASELINE,
      remoteSha: REMOTE,
    });

    await replayOnNewTip({
      octokit,
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      conflict,
      ops: [{ kind: 'create', key: 'my-staged-key', value: { x: 1 }, enqueuedAt: new Date() }],
      message: 'replayed commit',
      checkOverlap: true,
    });

    const compareCall = request.mock.calls.find(
      ([route]: [string]) => route === 'GET /repos/{owner}/{repo}/compare/{basehead}',
    );
    expect(compareCall).toBeDefined();
    const [, compareParams] = compareCall as [string, Record<string, unknown>];
    expect(compareParams).toMatchObject({
      owner: OWNER,
      repo: REPO,
      basehead: `${BASELINE}...${REMOTE}`,
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Webhook subscribe
// ---------------------------------------------------------------------------

describe('POST /repos/{owner}/{repo}/hooks — webhook subscribe', () => {
  it('calls the hooks endpoint with correct body shape', async () => {
    const request = vi.fn().mockResolvedValue(ok(HOOK_CREATE_RESP));
    const octokit = makeMockOctokit(request);

    const result = await subscribeWebhook(octokit, OWNER, REPO, {
      events: ['push'],
      callbackUrl: 'https://example.com/hook',
    });

    expect(request).toHaveBeenCalledOnce();
    const [route, params] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(route).toBe('POST /repos/{owner}/{repo}/hooks');
    expect(params).toMatchObject({
      owner: OWNER,
      repo: REPO,
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: 'https://example.com/hook',
        content_type: 'json',
      },
    });

    // Response is correctly mapped
    expect(result.id).toBe(42);
    expect(result.active).toBe(true);
    expect(result.events).toEqual(['push']);
    expect(result.callbackUrl).toBe('https://example.com/hook');
  });
});

// ---------------------------------------------------------------------------
// 12. Webhook list
// ---------------------------------------------------------------------------

describe('GET /repos/{owner}/{repo}/hooks — webhook list', () => {
  it('calls the hooks endpoint and returns mapped subscriptions', async () => {
    const request = vi.fn().mockResolvedValue(ok(HOOK_LIST_RESP));
    const octokit = makeMockOctokit(request);

    const result = await listWebhooks(octokit, OWNER, REPO);

    expect(request).toHaveBeenCalledOnce();
    const [route, params] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(route).toBe('GET /repos/{owner}/{repo}/hooks');
    expect(params).toMatchObject({ owner: OWNER, repo: REPO });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 42,
      active: true,
      events: ['push'],
      callbackUrl: 'https://example.com/hook',
    });
  });
});

// ---------------------------------------------------------------------------
// 13. Webhook unsubscribe
// ---------------------------------------------------------------------------

describe('DELETE /repos/{owner}/{repo}/hooks/{hook_id} — webhook unsubscribe', () => {
  it('calls the delete endpoint with owner, repo, and hook_id', async () => {
    const request = vi.fn().mockResolvedValue({ data: undefined, status: 204 });
    const octokit = makeMockOctokit(request);

    await unsubscribeWebhook(octokit, OWNER, REPO, 42);

    expect(request).toHaveBeenCalledOnce();
    const [route, params] = request.mock.calls[0] as [string, Record<string, unknown>];
    expect(route).toBe('DELETE /repos/{owner}/{repo}/hooks/{hook_id}');
    expect(params).toMatchObject({
      owner: OWNER,
      repo: REPO,
      hook_id: 42,
    });
  });
});
