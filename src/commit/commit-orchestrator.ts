import type { Octokit } from '@octokit/rest';
import { ConflictError, GhDbError, ValidationError } from '../errors/index.js';
import { resolveConflictPolicy } from '../conflict/policy.js';
import { replayOnNewTip } from '../conflict/rebase.js';
import { toGhDbError } from '../client/http-error.js';
import type { InstanceConfig } from '../core/instance-config.js';
import { StagingArea } from '../staging/staging-area.js';
import type { CachedTip } from '../crud/retrieve.js';
import type {
  CommitOptions,
  CommitResult,
} from '../types/public.js';
import { runCommitPipeline } from './pipeline.js';

/** Inputs for {@link runCommit}. */
export interface CommitContext {
  /** Octokit client. */
  octokit: Octokit;
  /** Resolved instance config. */
  config: InstanceConfig;
  /** Staging area to drain on success. */
  staging: StagingArea;
  /** Cached tip state to update on success. */
  cachedTip: CachedTip;
  /** Resolved working branch. */
  branch: string;
}

/**
 * Top-level entry point for `commit()`. Coordinates message validation,
 * baseline capture, conflict-policy selection, the commit pipeline,
 * retry/rebase replay, and staging-area lifecycle.
 *
 * Per FR-013 / FR-022b, the staging area is cleared ONLY on success;
 * every failure path leaves it intact. The cached tip is updated to
 * the new commit's SHA on success.
 *
 * @param ctx See {@link CommitContext}.
 * @param options Per-commit options (message + optional policy override).
 * @returns A {@link CommitResult}.
 * @throws {ValidationError} when `message` is empty / whitespace-only.
 * @throws {ConflictError} under `'fail'` policy on a conflict, or under
 *   `'rebase'` on staged-key overlap.
 * @throws {RetryExhaustedError} when `'retry'` / `'rebase'` exhausts its
 *   attempt budget.
 */
export async function runCommit(
  ctx: CommitContext,
  options: CommitOptions,
): Promise<CommitResult> {
  // FR-014: every commit MUST carry a non-empty, non-whitespace message.
  if (typeof options.message !== 'string' || options.message.trim().length === 0) {
    throw new ValidationError('Commit message must be non-empty.', {
      subcode: 'invalid_input',
    });
  }
  if (ctx.staging.isEmpty()) {
    throw new ValidationError('Nothing to commit: staging area is empty.', {
      subcode: 'invalid_input',
    });
  }

  const policy = resolveConflictPolicy(ctx.config.conflictPolicy, options.conflictPolicy);

  // Ensure the staging baseline is captured. The CRUD wrappers may have
  // captured it already; if not (e.g., the caller chose to commit
  // before any staging-time read happened), fetch it now.
  if (ctx.staging.baselineSha === undefined || ctx.staging.baselineTreeSha === undefined) {
    await captureBaseline(ctx);
  }
  const baselineSha = ctx.staging.baselineSha;
  const baselineTreeSha = ctx.staging.baselineTreeSha;
  if (baselineSha === undefined || baselineTreeSha === undefined) {
    throw new GhDbError('server', 'Failed to capture commit baseline from GitHub.');
  }

  const ops = ctx.staging.all();
  const message = options.message;

  // First attempt — always against the captured baseline.
  const attempt = 0;
  let result;
  try {
    result = await runCommitPipeline({
      octokit: ctx.octokit,
      owner: ctx.config.owner,
      repo: ctx.config.repo,
      branch: ctx.branch,
      baselineSha,
      baselineTreeSha,
      ops,
      message,
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      result = await handleConflict(ctx, err, ops, message, policy, attempt);
    } else {
      throw err;
    }
  }

  // Success path: clear staging, refresh cached tip.
  ctx.staging.clear();
  ctx.cachedTip.sha = result.sha;
  ctx.cachedTip.treeSha = result.treeSha;
  ctx.cachedTip.observedAt = new Date();

  return {
    sha: result.sha,
    parentSha: result.parentSha,
    treeSha: result.treeSha,
    branch: ctx.branch,
    message,
  };
}

/**
 * Capture the staging baseline (tip + tree SHA) from GitHub.
 *
 * @param ctx Commit context.
 */
async function captureBaseline(ctx: CommitContext): Promise<void> {
  try {
    const refResp = await ctx.octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner: ctx.config.owner,
        repo: ctx.config.repo,
        ref: `heads/${ctx.branch}`,
      },
    );
    const sha = (refResp.data as { object?: { sha?: string } }).object?.sha;
    if (typeof sha !== 'string') {
      throw new Error('GitHub returned no ref SHA.');
    }
    const commitResp = await ctx.octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {
        owner: ctx.config.owner,
        repo: ctx.config.repo,
        commit_sha: sha,
      },
    );
    const treeSha = (commitResp.data as { tree?: { sha?: string } }).tree?.sha;
    if (typeof treeSha !== 'string') {
      throw new Error('GitHub returned no tree SHA for the baseline commit.');
    }
    ctx.staging.captureBaseline(sha, treeSha);
  } catch (err) {
    throw toGhDbError(err);
  }
}

/**
 * React to a {@link ConflictError} from the pipeline by applying the
 * resolved conflict policy.
 *
 * @param ctx Commit context.
 * @param firstError The ConflictError from the initial pipeline attempt.
 * @param ops Staged operations being committed.
 * @param message Commit message.
 * @param policy Resolved conflict policy.
 * @param startAttempt Attempt index when retrying starts.
 * @returns A successful pipeline result on recovery.
 * @throws {ConflictError} when policy is `'fail'`, or on `'rebase'` overlap.
 * @throws {RetryExhaustedError} when budget is consumed under retry/rebase.
 */
async function handleConflict(
  ctx: CommitContext,
  firstError: ConflictError,
  ops: ReturnType<StagingArea['all']>,
  message: string,
  policy: 'fail' | 'retry' | 'rebase',
  startAttempt: number,
): Promise<{ sha: string; parentSha: string; treeSha: string }> {
  if (policy === 'fail') {
    throw firstError;
  }
  const budget = ctx.config.conflictMaxAttempts;
  let lastConflict = firstError;
  // Each replay attempt counts against the budget; `attempt = 0` was
  // the original pipeline run.
  for (let attempt = startAttempt + 1; attempt < budget; attempt++) {
    try {
      return await replayOnNewTip({
        octokit: ctx.octokit,
        owner: ctx.config.owner,
        repo: ctx.config.repo,
        branch: ctx.branch,
        conflict: lastConflict,
        ops,
        message,
        checkOverlap: policy === 'rebase',
      });
    } catch (err) {
      if (err instanceof ConflictError) {
        // Overlap (rebase) or another non-fast-forward (retry) — keep
        // trying until the budget is consumed.
        if (policy === 'rebase' && err.overlappingKeys !== undefined) {
          throw err;
        }
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }
  // Budget exhausted — surface a ConflictError carrying the last
  // observed remote tip rather than `RetryExhaustedError`, because the
  // failure mode is "conflict that we could not resolve", which is
  // what the user-facing error class signals. RetryExhaustedError
  // tracks *transient* HTTP errors, not conflict-policy attempts.
  throw lastConflict;
}
