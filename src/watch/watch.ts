import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { toGhDbError } from '../client/http-error.js';
import type { InstanceConfig } from '../core/instance-config.js';
import { decodeJson } from '../serialization/decode.js';
import { validateKey } from '../validation/key.js';
import type { RetrieveResult, WatchCallback, WatchHandle, WatchOptions } from '../types/public.js';

/** Inputs for {@link startWatch}. */
export interface WatchContext {
  /** The configured Octokit client. */
  octokit: Octokit;
  /** Resolved instance config (incl. owner/repo). */
  config: InstanceConfig;
  /** The resolved working branch. */
  branch: string;
}

/**
 * Start polling a single key on the working branch and invoke `callback`
 * whenever the value changes (or on the first successful read).
 *
 * Passes `If-None-Match` with the last-seen ETag on every repeat request so
 * GitHub returns 304 when nothing changed — 304 responses do not count against
 * the primary rate-limit quota, making high-frequency polling practical for
 * turn-based games.
 *
 * @param ctx See {@link WatchContext}.
 * @param key The record key to watch.
 * @param callback Invoked with the new result on change, or with an error.
 * @param options See {@link WatchOptions}.
 * @returns A {@link WatchHandle} whose `unsubscribe()` stops polling.
 */
export function startWatch(
  ctx: WatchContext,
  key: string,
  callback: WatchCallback,
  options: WatchOptions = {},
): WatchHandle {
  validateKey(key);
  const intervalMs = Math.max(options.intervalMs ?? 5000, 1000);
  let active = true;
  let lastEtag: string | undefined;

  const poll = async (): Promise<void> => {
    if (!active) return;

    try {
      const extraHeaders: Record<string, string> = {};
      if (lastEtag !== undefined) {
        extraHeaders['if-none-match'] = lastEtag;
      }

      const response = await ctx.octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner: ctx.config.owner,
          repo: ctx.config.repo,
          path: `${key}.json`,
          ref: ctx.branch,
          headers: extraHeaders,
        },
      );

      const etag = (response.headers as Record<string, string | undefined>)['etag'];
      if (typeof etag === 'string') lastEtag = etag;

      const body = response.data as { content?: string; encoding?: string };
      let result: RetrieveResult;
      if (typeof body.content !== 'string') {
        result = { found: false };
      } else {
        const raw = decodeGitHubContent(body.content, body.encoding ?? '');
        const value = decodeJson(key, raw);
        result = { found: true, value };
      }
      callback(null, result);
    } catch (err) {
      if (err instanceof RequestError && err.status === 304) {
        // ETag matched — content unchanged, skip callback.
      } else if (err instanceof RequestError && err.status === 404) {
        callback(null, { found: false });
      } else {
        callback(toGhDbError(err) as Error, undefined);
      }
    }

    if (active) {
      setTimeout(() => void poll(), intervalMs);
    }
  };

  void poll();

  return {
    unsubscribe(): void {
      active = false;
    },
  };
}

/**
 * Decode GitHub's base64-encoded file content without Node's Buffer API.
 * Uses `atob` + `TextDecoder` (available in browsers and Node 16+).
 */
function decodeGitHubContent(content: string, encoding: string): string {
  if (encoding === 'base64') {
    const binary = atob(content.replace(/\n/g, ''));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return content;
}
