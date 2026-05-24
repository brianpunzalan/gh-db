import { RequestError } from '@octokit/request-error';
import { classifyError } from '../retry/classify.js';
import type { GhDbError } from '../errors/index.js';

/**
 * Map an Octokit {@link RequestError} (or arbitrary thrown value) to a
 * typed gh-db error.
 *
 * Delegates to the retry classifier so the same mapping table feeds both
 * the retry loop and any direct error-surface path (the commit pipeline
 * also intercepts conflict 422s ahead of this — see commit-pipeline).
 *
 * @param err The error caught from an Octokit call.
 * @returns A typed gh-db error subclass.
 */
export function toGhDbError(err: unknown): GhDbError {
  return classifyError(err).error;
}

/**
 * Type-guard for Octokit {@link RequestError}.
 *
 * @param err Arbitrary thrown value.
 * @returns True when `err` is an Octokit RequestError.
 */
export function isRequestError(err: unknown): err is RequestError {
  return err instanceof RequestError;
}
