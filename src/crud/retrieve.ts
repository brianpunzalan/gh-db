import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { toGhDbError } from '../client/http-error.js';
import type { InstanceConfig } from '../core/instance-config.js';
import { decodeJson } from '../serialization/decode.js';
import type { StagingArea } from '../staging/staging-area.js';
import { validateKey } from '../validation/key.js';
import type { JsonValue, RetrieveResult } from '../types/public.js';

/** Cached tip state used by `'cached'` read mode. */
export interface CachedTip {
  /** Latest observed working-branch tip SHA. */
  sha: string | undefined;
  /** Latest observed tree SHA reachable from `sha`. */
  treeSha: string | undefined;
  /** Time the cached tip was last observed. */
  observedAt: Date | undefined;
}

/** Inputs for {@link retrieveRecord}. */
export interface RetrieveContext {
  /** The configured Octokit client. */
  octokit: Octokit;
  /** Resolved instance config (incl. owner/repo/branch). */
  config: InstanceConfig;
  /** The instance's staging area (for staging-aware reads). */
  staging: StagingArea;
  /** The instance's cached tip state. */
  cachedTip: CachedTip;
  /** The resolved working branch (after default-branch fallback). */
  branch: string;
}

/**
 * Retrieve the value of a JSON record under `key`.
 *
 * Staging-aware: a pending create/update returns the staged value, and
 * a pending delete returns `{ found: false }`. For un-staged keys, the
 * resolved read targets the working branch tip per the configured
 * read-consistency policy (R-005).
 *
 * Under `'fresh'`, the tip is refreshed first by GET-ing the ref. Under
 * `'cached'`, the cached tip is used and only updated by commit /
 * rollback / explicit `refresh()`.
 *
 * @param ctx See {@link RetrieveContext}.
 * @param key The record key to read.
 * @returns A {@link RetrieveResult}.
 */
export async function retrieveRecord(
  ctx: RetrieveContext,
  key: string,
): Promise<RetrieveResult> {
  validateKey(key);
  const staged = ctx.staging.get(key);
  if (staged !== undefined) {
    if (staged.kind === 'delete') return { found: false };
    return { found: true, value: staged.value as JsonValue };
  }

  let ref: string;
  if (ctx.config.readConsistency === 'fresh') {
    ref = await refreshTipSha(ctx);
  } else if (ctx.cachedTip.sha !== undefined) {
    ref = ctx.cachedTip.sha;
  } else {
    // First read under 'cached' mode still needs *something* to read
    // against; refresh once so subsequent reads are stable.
    ref = await refreshTipSha(ctx);
  }

  try {
    const path = `${key}.json`;
    const response = await ctx.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: ctx.config.owner,
      repo: ctx.config.repo,
      path,
      ref,
    });
    const body = response.data as { content?: string; encoding?: string };
    if (typeof body.content !== 'string') {
      // GitHub responded but the payload was not a file; surface as
      // "not found" rather than fabricating a value.
      return { found: false };
    }
    // GitHub returns base64-encoded content with embedded newlines.
    const content = Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8').toString(
      'utf8',
    );
    const value = decodeJson(key, content);
    return { found: true, value };
  } catch (err) {
    if (err instanceof RequestError && err.status === 404) {
      return { found: false };
    }
    throw toGhDbError(err);
  }
}

/**
 * Refresh the cached working-branch tip by GET-ing the ref.
 *
 * Updates the cached tip in place and returns the new SHA.
 *
 * @param ctx See {@link RetrieveContext}.
 * @returns The new tip commit SHA.
 */
export async function refreshTipSha(ctx: RetrieveContext): Promise<string> {
  try {
    const response = await ctx.octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner: ctx.config.owner,
        repo: ctx.config.repo,
        ref: `heads/${ctx.branch}`,
      },
    );
    const sha = (response.data as { object?: { sha?: string } }).object?.sha;
    if (typeof sha !== 'string') {
      throw new Error('GitHub returned no object SHA for the requested ref.');
    }
    ctx.cachedTip.sha = sha;
    ctx.cachedTip.observedAt = new Date();
    return sha;
  } catch (err) {
    throw toGhDbError(err);
  }
}
