import type { Octokit } from '@octokit/rest';
import { RollbackError } from '../errors/index.js';
import { toGhDbError } from '../client/http-error.js';
import type { InstanceConfig } from '../core/instance-config.js';
import type { StagingArea } from '../staging/staging-area.js';
import type { CachedTip } from '../crud/retrieve.js';

/** Inputs for {@link runRollback}. */
export interface RollbackContext {
  /** Octokit client. */
  octokit: Octokit;
  /** Resolved instance config. */
  config: InstanceConfig;
  /** Staging area (must be empty per FR-020). */
  staging: StagingArea;
  /** Cached tip state to update on success. */
  cachedTip: CachedTip;
  /** Resolved working branch. */
  branch: string;
}

/**
 * Force-update the working branch tip to the parent of the current tip.
 *
 * Implements R-003: GET the current commit, read `parents[0]`, then
 * PATCH the ref with `force=true`. Refuses to run when the staging
 * area is non-empty (FR-020) or when the current tip is the initial
 * commit / has no parents (FR-019).
 *
 * @param ctx See {@link RollbackContext}.
 * @throws {RollbackError} when staging is non-empty or no parent exists.
 * @throws {GhDbError} for underlying GitHub failures.
 */
export async function runRollback(ctx: RollbackContext): Promise<void> {
  if (!ctx.staging.isEmpty()) {
    throw new RollbackError(
      'Rollback refused: staging area is non-empty. Call reset() or commit() first.',
      { reason: 'staging_not_empty' },
    );
  }

  // Get the current tip SHA.
  let currentSha: string;
  try {
    const refResp = await ctx.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner: ctx.config.owner,
      repo: ctx.config.repo,
      ref: `heads/${ctx.branch}`,
    });
    const sha = (refResp.data as { object?: { sha?: string } }).object?.sha;
    if (typeof sha !== 'string') {
      throw new Error('GitHub returned no ref SHA.');
    }
    currentSha = sha;
  } catch (err) {
    throw toGhDbError(err);
  }

  // Read the current commit to learn its parent. The Git Data API
  // returns `parents` as an array of `{sha, url, html_url}` — we want
  // the first parent's SHA. An empty array means the current tip is
  // the initial commit and rollback is impossible (FR-019).
  let parentSha: string | undefined;
  try {
    const commitResp = await ctx.octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {
        owner: ctx.config.owner,
        repo: ctx.config.repo,
        commit_sha: currentSha,
      },
    );
    const parents = (commitResp.data as { parents?: Array<{ sha?: string }> }).parents;
    parentSha = parents?.[0]?.sha;
  } catch (err) {
    throw toGhDbError(err);
  }
  if (parentSha === undefined) {
    throw new RollbackError('Rollback refused: current commit has no parent (initial commit).', {
      reason: 'initial_commit',
    });
  }

  // Force-update the ref to the parent. The spec's Assumptions section
  // locks rollback semantics to a hard reset; force=true is the precise
  // GitHub-API expression of that.
  try {
    await ctx.octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner: ctx.config.owner,
      repo: ctx.config.repo,
      ref: `heads/${ctx.branch}`,
      sha: parentSha,
      force: true,
    });
  } catch (err) {
    throw toGhDbError(err);
  }

  // Update the cached tip so subsequent reads under `'cached'` mode see
  // the rolled-back state immediately.
  ctx.cachedTip.sha = parentSha;
  ctx.cachedTip.treeSha = undefined;
  ctx.cachedTip.observedAt = new Date();
}
