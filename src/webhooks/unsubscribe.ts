import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { NotFoundError } from '../errors/index.js';
import { toGhDbError } from '../client/http-error.js';

/**
 * Remove a webhook from the configured repository by GitHub's hook id.
 *
 * A 404 is mapped to {@link NotFoundError} with `resourceKind: 'hook'`
 * so callers can distinguish it from a missing repo / branch.
 *
 * @param octokit Octokit client.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param id GitHub's hook id.
 */
export async function unsubscribeWebhook(
  octokit: Octokit,
  owner: string,
  repo: string,
  id: number,
): Promise<void> {
  try {
    await octokit.request('DELETE /repos/{owner}/{repo}/hooks/{hook_id}', {
      owner,
      repo,
      hook_id: id,
    });
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      throw new NotFoundError(`Webhook with id ${id} not found on this repository.`, {
        resourceKind: 'hook',
        cause: err,
      });
    }
    throw toGhDbError(err);
  }
}
