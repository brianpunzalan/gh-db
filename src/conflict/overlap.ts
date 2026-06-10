import type { Octokit } from '@octokit/rest';
import { toGhDbError } from '../client/http-error.js';

/** Inputs for {@link detectOverlap}. */
export interface OverlapInput {
  /** Octokit client. */
  octokit: Octokit;
  /** Repository owner. */
  owner: string;
  /** Repository name. */
  repo: string;
  /** Baseline commit SHA (the staging baseline). */
  baselineSha: string;
  /** Remote tip SHA after the external commit. */
  remoteSha: string;
  /** Set of keys currently in the staging area. */
  stagedKeys: Set<string>;
}

/**
 * Detect which staged keys overlap with files changed by external
 * commits between `baselineSha` and `remoteSha`.
 *
 * Uses GitHub's compare endpoint, which already returns a per-file
 * change list (no need to reconstruct tree diffs ourselves). The
 * `files[].filename` array contains paths; gh-db strips the `.json`
 * suffix to recover record keys for the intersection.
 *
 * @param input See {@link OverlapInput}.
 * @returns Sorted array of overlapping keys (possibly empty).
 */
export async function detectOverlap(input: OverlapInput): Promise<string[]> {
  if (input.baselineSha === input.remoteSha) return [];
  try {
    const response = await input.octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
      owner: input.owner,
      repo: input.repo,
      basehead: `${input.baselineSha}...${input.remoteSha}`,
    });
    const body = response.data as { files?: Array<{ filename?: string }> };
    const files = body.files ?? [];
    const overlapping: string[] = [];
    for (const f of files) {
      if (typeof f.filename !== 'string') continue;
      if (!f.filename.endsWith('.json')) continue;
      // gh-db stores every record as `<key>.json` at the root, so any
      // file with a slash in its path is something else (e.g., a
      // workflow file). We skip those.
      if (f.filename.includes('/')) continue;
      const key = f.filename.slice(0, -'.json'.length);
      if (input.stagedKeys.has(key)) {
        overlapping.push(key);
      }
    }
    overlapping.sort();
    return overlapping;
  } catch (err) {
    throw toGhDbError(err);
  }
}
