import type { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { toGhDbError } from '../client/http-error.js';
import { ValidationError } from '../errors/index.js';
import type {
  CreateRepositoryOptions,
  CreateRepositoryResult,
} from '../types/public.js';

/**
 * Provision a new GitHub repository under the configured account or
 * organization.
 *
 * Routes to `POST /user/repos` when no `organization` is supplied and
 * to `POST /orgs/{org}/repos` otherwise. The new repo is initialized
 * with `auto_init: true` so an initial commit and default branch exist
 * immediately — required by Story 4 acceptance scenario 1 to support
 * an immediate subsequent commit.
 *
 * @param octokit Octokit client.
 * @param options See {@link CreateRepositoryOptions}.
 * @returns A {@link CreateRepositoryResult}.
 * @throws {ValidationError} when GitHub reports the name already exists.
 * @throws {GhDbError} for other GitHub failures.
 */
export async function createRepository(
  octokit: Octokit,
  options: CreateRepositoryOptions,
): Promise<CreateRepositoryResult> {
  if (typeof options.name !== 'string' || options.name.length === 0) {
    throw new ValidationError(`Invalid 'name' for createRepository.`, {
      subcode: 'invalid_input',
    });
  }
  if (options.visibility !== 'public' && options.visibility !== 'private') {
    throw new ValidationError(
      `Invalid 'visibility': ${String(options.visibility)}. Expected 'public' | 'private'.`,
      { subcode: 'invalid_input' },
    );
  }

  const body = {
    name: options.name,
    private: options.visibility === 'private',
    auto_init: true,
    ...(options.description !== undefined ? { description: options.description } : {}),
  };

  let owner: string;
  let defaultBranch: string;
  try {
    if (options.organization !== undefined) {
      const resp = await octokit.request('POST /orgs/{org}/repos', {
        org: options.organization,
        ...body,
      });
      const data = resp.data as {
        owner?: { login?: string };
        default_branch?: string;
      };
      owner = data.owner?.login ?? options.organization;
      defaultBranch = data.default_branch ?? 'main';
    } else {
      const resp = await octokit.request('POST /user/repos', body);
      const data = resp.data as {
        owner?: { login?: string };
        default_branch?: string;
      };
      owner = data.owner?.login ?? '';
      defaultBranch = data.default_branch ?? 'main';
    }
  } catch (err) {
    if (err instanceof RequestError && err.status === 422 && isAlreadyExistsError(err)) {
      throw new ValidationError(
        `Repository '${options.name}' already exists for this owner.`,
        { subcode: 'already_exists', cause: err },
      );
    }
    throw toGhDbError(err);
  }

  // `auto_init: true` creates an initial commit; fetch its SHA so the
  // caller has a useful handle for tagging / linking. A separate ref
  // GET is cheaper here than reading the create-repo response shape,
  // which does not include the initial commit.
  let initialCommitSha = '';
  try {
    const refResp = await octokit.request(
      'GET /repos/{owner}/{repo}/git/ref/{ref}',
      {
        owner,
        repo: options.name,
        ref: `heads/${defaultBranch}`,
      },
    );
    initialCommitSha =
      (refResp.data as { object?: { sha?: string } }).object?.sha ?? '';
  } catch {
    // Non-fatal: the repo was created. Leave the SHA empty rather than
    // failing the caller's repo-creation flow.
  }

  return {
    owner,
    name: options.name,
    defaultBranch,
    initialCommitSha,
  };
}

/**
 * Inspect a 422 response body to detect the "name already exists" case
 * from GitHub's repository-create endpoint.
 *
 * @param err Octokit request error.
 * @returns True when GitHub reported the name as already taken.
 */
function isAlreadyExistsError(err: RequestError): boolean {
  const body = err.response?.data as
    | {
        errors?: Array<{ message?: string; code?: string }>;
        message?: string;
      }
    | undefined;
  if (!body) return false;
  const messages = [body.message ?? '', ...(body.errors?.map((e) => e.message ?? '') ?? [])];
  return messages.some((m) => /name already exists|already exists/i.test(m));
}
