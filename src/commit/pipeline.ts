import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { ConflictError } from '../errors/index.js';
import { toGhDbError } from '../client/http-error.js';
import { encodeJson } from '../serialization/encode.js';
import type { StagedOperation } from '../types/public.js';
import { buildTreeEntries, type BlobShaMap } from './tree-builder.js';

/** Inputs to {@link runCommitPipeline}. */
export interface CommitPipelineInput {
  /** Octokit client. */
  octokit: Octokit;
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Working branch. */
  branch: string;
  /** Staging baseline commit SHA (commit's parent). */
  baselineSha: string;
  /** Staging baseline tree SHA (for `base_tree`). */
  baselineTreeSha: string;
  /** Ordered staged operations to apply. */
  ops: StagedOperation[];
  /** Commit message. */
  message: string;
}

/** Result of a successful commit pipeline run. */
export interface CommitPipelineResult {
  /** New commit SHA. */
  sha: string;
  /** Parent commit SHA (= input `baselineSha`). */
  parentSha: string;
  /** Tree SHA created for this commit. */
  treeSha: string;
}

/**
 * Execute the four-step Git Data API commit pipeline.
 *
 * 1. POST blobs (one per create/update — content-addressed, so reposting
 *    the same content yields the same SHA; deletes contribute no blob).
 * 2. POST a tree with `base_tree=<baselineTreeSha>` + per-op entries.
 * 3. POST a commit referencing the new tree and `parents=[baselineSha]`.
 * 4. PATCH the ref with `force=false`. A 422 "not a fast-forward"
 *    surfaces as a {@link ConflictError} carrying both SHAs so the
 *    caller's conflict policy can act on it.
 *
 * @param input See {@link CommitPipelineInput}.
 * @returns The new commit's SHA + parent + tree.
 * @throws {ConflictError} On non-fast-forward ref update.
 * @throws {GhDbError} For any other GitHub-side failure.
 */
export async function runCommitPipeline(
  input: CommitPipelineInput,
): Promise<CommitPipelineResult> {
  const blobShas: BlobShaMap = new Map<string, string>();

  try {
    for (const op of input.ops) {
      if (op.kind === 'delete') continue;
      // encodeJson re-serializes the value on the commit path. It is
      // cheap and guarantees we never persist anything the caller
      // managed to slip past the staging-time validation (e.g., via
      // post-staging mutation of the cached value object).
      const content = encodeJson(op.key, op.value);
      const blobResp = await input.octokit.request(
        'POST /repos/{owner}/{repo}/git/blobs',
        {
          owner: input.owner,
          repo: input.repo,
          content,
          encoding: 'utf-8',
        },
      );
      const sha = (blobResp.data as { sha?: string }).sha;
      if (typeof sha !== 'string') {
        throw new Error(`GitHub did not return a blob SHA for key '${op.key}'.`);
      }
      blobShas.set(op.key, sha);
    }

    const treeEntries = buildTreeEntries(input.ops, blobShas);
    const treeResp = await input.octokit.request('POST /repos/{owner}/{repo}/git/trees', {
      owner: input.owner,
      repo: input.repo,
      base_tree: input.baselineTreeSha,
      tree: treeEntries.map((e) => ({
        path: e.path,
        mode: e.mode,
        type: e.type,
        sha: e.sha,
      })) as unknown as never,
    });
    const treeSha = (treeResp.data as { sha?: string }).sha;
    if (typeof treeSha !== 'string') {
      throw new Error('GitHub did not return a tree SHA.');
    }

    const commitResp = await input.octokit.request(
      'POST /repos/{owner}/{repo}/git/commits',
      {
        owner: input.owner,
        repo: input.repo,
        message: input.message,
        tree: treeSha,
        parents: [input.baselineSha],
      },
    );
    const commitSha = (commitResp.data as { sha?: string }).sha;
    if (typeof commitSha !== 'string') {
      throw new Error('GitHub did not return a commit SHA.');
    }

    try {
      await input.octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner: input.owner,
        repo: input.repo,
        ref: `heads/${input.branch}`,
        sha: commitSha,
        force: false,
      });
    } catch (err) {
      // The ref-update step is where the conflict is detected. Convert
      // the 422 "not fast-forward" into a typed ConflictError carrying
      // the SHAs so the conflict policy can decide what to do.
      if (err instanceof RequestError && err.status === 422 && isNotFastForward(err)) {
        // Read the remote tip SHA to populate the error. We fall back
        // to an empty string if the ref read also fails; in practice the
        // caller's conflict policy will read it independently before
        // deciding to retry.
        let remoteSha = '';
        try {
          const refResp = await input.octokit.request(
            'GET /repos/{owner}/{repo}/git/ref/{ref}',
            {
              owner: input.owner,
              repo: input.repo,
              ref: `heads/${input.branch}`,
            },
          );
          remoteSha = (refResp.data as { object?: { sha?: string } }).object?.sha ?? '';
        } catch {
          // Ignore — the conflict-policy layer can still observe a
          // remote-vs-baseline mismatch by re-fetching itself.
        }
        throw new ConflictError('Commit failed: branch tip has advanced.', {
          baselineSha: input.baselineSha,
          remoteSha,
          cause: err,
        });
      }
      throw toGhDbError(err);
    }

    return {
      sha: commitSha,
      parentSha: input.baselineSha,
      treeSha,
    };
  } catch (err) {
    if (err instanceof ConflictError) throw err;
    // Anything else (blob/tree/commit create failure) gets the standard
    // classification treatment.
    throw toGhDbError(err);
  }
}

/**
 * Detect the "Update is not a fast-forward" 422 emitted by GitHub on
 * stale ref updates.
 *
 * @param err Octokit request error.
 * @returns True when the response body signals a non-fast-forward.
 */
function isNotFastForward(err: RequestError): boolean {
  const body = err.response?.data as { message?: string } | undefined;
  const msg = body?.message ?? err.message ?? '';
  return /not\s*a\s*fast[-\s]?forward/i.test(msg) || msg.length === 0;
}
