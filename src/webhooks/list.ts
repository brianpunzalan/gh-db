import type { Octokit } from '@octokit/rest';
import { toGhDbError } from '../client/http-error.js';
import type { WebhookSubscription } from '../types/public.js';
import { toSubscription } from './subscribe.js';

/**
 * List all webhooks currently registered on the configured repository.
 *
 * Returns subscriptions registered through gh-db AND any other source
 * (gh-db does not filter by who registered the hook).
 *
 * @param octokit Octokit client.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @returns An array of {@link WebhookSubscription}.
 */
export async function listWebhooks(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<WebhookSubscription[]> {
  try {
    const resp = await octokit.request('GET /repos/{owner}/{repo}/hooks', {
      owner,
      repo,
    });
    const data = resp.data as unknown[];
    return data.map((h) => toSubscription(h));
  } catch (err) {
    throw toGhDbError(err);
  }
}
