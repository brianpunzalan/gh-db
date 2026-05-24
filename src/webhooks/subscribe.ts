import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { toGhDbError } from '../client/http-error.js';
import { ValidationError } from '../errors/index.js';
import type {
  WebhookSubscription,
  WebhookSubscriptionOptions,
} from '../types/public.js';

/**
 * Register a webhook on the configured repository.
 *
 * gh-db forwards the event list verbatim to GitHub (no local catalog of
 * event names per R-013). Performs only minimal client-side validation:
 * `events` must be a non-empty array of non-empty strings, and
 * `callbackUrl` must be a parseable `http://` or `https://` URL.
 *
 * @param octokit Octokit client.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param options See {@link WebhookSubscriptionOptions}.
 * @returns A {@link WebhookSubscription} containing GitHub's hook id.
 */
export async function subscribeWebhook(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: WebhookSubscriptionOptions,
): Promise<WebhookSubscription> {
  validateOptions(options);

  try {
    const resp = await octokit.request('POST /repos/{owner}/{repo}/hooks', {
      owner,
      repo,
      name: 'web',
      active: options.active ?? true,
      events: options.events,
      config: {
        url: options.callbackUrl,
        content_type: 'json',
      },
    });
    return toSubscription(resp.data, options.callbackUrl);
  } catch (err) {
    if (err instanceof RequestError && err.status === 422) {
      throw new ValidationError('GitHub rejected the webhook configuration.', {
        subcode: 'invalid_event',
        cause: err,
      });
    }
    throw toGhDbError(err);
  }
}

/**
 * Validate `subscribeWebhook` input options.
 *
 * @param options Caller-supplied input.
 * @throws {ValidationError} when validation fails.
 */
function validateOptions(options: WebhookSubscriptionOptions): void {
  if (!Array.isArray(options.events) || options.events.length === 0) {
    throw new ValidationError(
      `'events' must be a non-empty array of strings.`,
      { subcode: 'invalid_input' },
    );
  }
  for (const e of options.events) {
    if (typeof e !== 'string' || e.length === 0) {
      throw new ValidationError(
        `Every entry of 'events' must be a non-empty string.`,
        { subcode: 'invalid_input' },
      );
    }
  }
  if (typeof options.callbackUrl !== 'string' || options.callbackUrl.length === 0) {
    throw new ValidationError(`'callbackUrl' must be a non-empty string.`, {
      subcode: 'invalid_input',
    });
  }
  try {
    const url = new URL(options.callbackUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch (err) {
    throw new ValidationError(`'callbackUrl' is not a valid URL.`, {
      subcode: 'invalid_input',
      cause: err,
    });
  }
}

/**
 * Map a GitHub hook response payload to gh-db's {@link WebhookSubscription}.
 *
 * @param data Raw response payload from GitHub.
 * @param fallbackCallbackUrl URL to use when the response omits it (rare).
 * @returns A WebhookSubscription.
 */
export function toSubscription(
  data: unknown,
  fallbackCallbackUrl?: string,
): WebhookSubscription {
  const d = data as {
    id?: number;
    active?: boolean;
    events?: string[];
    config?: { url?: string };
    last_response?: { status?: string };
  };
  return {
    id: d.id ?? 0,
    callbackUrl: d.config?.url ?? fallbackCallbackUrl ?? '',
    events: d.events ?? [],
    active: d.active ?? true,
    ...(d.last_response?.status ? { lastDeliveryStatus: d.last_response.status } : {}),
  };
}
