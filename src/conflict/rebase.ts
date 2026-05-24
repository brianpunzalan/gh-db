import type { Octokit } from '@octokit/rest';
import { ConflictError } from '../errors/index.js';
import { toGhDbError } from '../client/http-error.js';
import type { StagedOperation } from '../types/public.js';
import { runCommitPipeline, type CommitPipelineResult } from '../commit/pipeline.js';
import { detectOverlap } from './overlap.js';

/** Inputs for {@link replayOnNewTip}. */
export interface ReplayInput {
  /** Octokit client. */
  octokit: Octokit;
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Working branch. */
  branch: string;
  /** Conflict error raised by the failed pipeline run. */
  conflict: ConflictError;
  /** Ordered staged operations. */
  ops: StagedOperation[];
  /** Commit message. */
  message: string;
  /** When true, abort if any staged key overlaps external changes. */
  checkOverlap: boolean;
}

/**
 * Refetch the working-branch tip + tree, recompute the commit on top
 * of it, and re-run the pipeline.
 *
 * Under `rebase`, callers pass `checkOverlap = true` so this helper
 * first detects whether any staged key was also touched by external
 * commits. On overlap, it throws a fresh {@link ConflictError} with
 * `overlappingKeys` set — the staging area is preserved by the
 * orchestrator above.
 *
 * @param input See {@link ReplayInput}.
 * @returns The new commit's pipeline result.
 * @throws {ConflictError} on overlap (rebase mode only).
 * @throws {GhDbError} for underlying GitHub failures.
 */
export async function replayOnNewTip(input: ReplayInput): Promise<CommitPipelineResult> {
  // Refetch the tip + tree to get the new base for the replay.
  let remoteSha: string;
  let remoteTreeSha: string;
  try {
    const refResp = await input.octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner: input.owner,
        repo: input.repo,
        ref: `heads/${input.branch}`,
      },
    );
    const sha = (refResp.data as { object?: { sha?: string } }).object?.sha;
    if (typeof sha !== 'string') {
      throw new Error('GitHub returned no ref SHA on refetch.');
    }
    remoteSha = sha;
    const commitResp = await input.octokit.request(
      'GET /repos/{owner}/{repo}/git/commits/{commit_sha}',
      {
        owner: input.owner,
        repo: input.repo,
        commit_sha: remoteSha,
      },
    );
    const treeSha = (commitResp.data as { tree?: { sha?: string } }).tree?.sha;
    if (typeof treeSha !== 'string') {
      throw new Error('GitHub returned no tree SHA for the new tip.');
    }
    remoteTreeSha = treeSha;
  } catch (err) {
    throw toGhDbError(err);
  }

  if (input.checkOverlap) {
    const stagedKeys = new Set<string>(input.ops.map((op) => op.key));
    const overlapping = await detectOverlap({
      octokit: input.octokit,
      owner: input.owner,
      repo: input.repo,
      baselineSha: input.conflict.baselineSha,
      remoteSha,
      stagedKeys,
    });
    if (overlapping.length > 0) {
      throw new ConflictError(
        `Rebase aborted: staged keys overlap external changes (${overlapping.join(', ')}).`,
        {
          baselineSha: input.conflict.baselineSha,
          remoteSha,
          overlappingKeys: overlapping,
        },
      );
    }
  }

  // Replay the commit on the new tip. Blob SHAs are content-addressed,
  // so re-posting the same content is idempotent (GitHub returns the
  // existing SHA). We still re-run the full pipeline to recompute the
  // tree on `remoteTreeSha` and to PATCH the ref with the freshly-
  // computed commit.
  return runCommitPipeline({
    octokit: input.octokit,
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    baselineSha: remoteSha,
    baselineTreeSha: remoteTreeSha,
    ops: input.ops,
    message: input.message,
  });
}
