import type { Octokit } from '@octokit/rest';
import { createOctokitClient } from '../client/octokit-client.js';
import { runCommit } from '../commit/commit-orchestrator.js';
import { stageCreateInArea } from '../crud/create.js';
import { stageDeleteInArea } from '../crud/delete.js';
import {
  refreshTipSha,
  retrieveRecord,
  type CachedTip,
  type RetrieveContext,
} from '../crud/retrieve.js';
import { stageUpdateInArea } from '../crud/update.js';
import { toGhDbError } from '../client/http-error.js';
import { createRepository } from '../repository/create-repository.js';
import { runRollback } from '../rollback/rollback.js';
import { listStaged } from '../staging/inspect.js';
import { StagingArea } from '../staging/staging-area.js';
import { listWebhooks } from '../webhooks/list.js';
import { subscribeWebhook } from '../webhooks/subscribe.js';
import { unsubscribeWebhook } from '../webhooks/unsubscribe.js';
import type {
  CommitOptions,
  CommitResult,
  CreateRepositoryOptions,
  CreateRepositoryResult,
  GhDbConfig,
  JsonValue,
  RetrieveResult,
  StagedOperation,
  WebhookSubscription,
  WebhookSubscriptionOptions,
} from '../types/public.js';
import { parseInstanceConfig, type InstanceConfig } from './instance-config.js';

/**
 * Entry point for using a GitHub repository as a JSON datastore.
 *
 * One instance corresponds to one (owner, repo, branch, baseUrl, token)
 * tuple. The instance owns an in-memory staging area; staged changes
 * are visible only to this instance and never leave the host process
 * until a commit succeeds.
 */
export class GhDb {
  private readonly config: InstanceConfig;
  private readonly octokit: Octokit;
  private readonly staging: StagingArea = new StagingArea();
  private readonly cachedTip: CachedTip = {
    sha: undefined,
    treeSha: undefined,
    observedAt: undefined,
  };
  private resolvedBranch: string | undefined;

  /**
   * Construct a new gh-db instance bound to a configured GitHub
   * repository. No GitHub API calls are made during construction; the
   * working branch is resolved lazily on the first network operation.
   *
   * @param config The instance configuration. See {@link GhDbConfig}.
   * @throws {GhDbError} when `config` fails validation.
   */
  public constructor(config: GhDbConfig) {
    this.config = parseInstanceConfig(config);
    this.octokit = createOctokitClient({
      auth: this.config.auth,
      baseUrl: this.config.baseUrl,
      userAgent: this.config.userAgent,
      retryMaxAttempts: this.config.retryMaxAttempts,
      retryBaseDelayMs: this.config.retryBaseDelayMs,
    });
    if (this.config.branch !== undefined) {
      this.resolvedBranch = this.config.branch;
    }
  }

  /**
   * Create a new GitHub repository under the configured owner with the
   * given name and visibility.
   *
   * @param options See {@link CreateRepositoryOptions}.
   * @returns A {@link CreateRepositoryResult}.
   */
  public async createRepository(
    options: CreateRepositoryOptions,
  ): Promise<CreateRepositoryResult> {
    return createRepository(this.octokit, options);
  }

  /**
   * Stage the creation of a JSON record under `key`.
   *
   * @param key Single flat segment (no `/`, no `\`, non-empty).
   * @param value Any JSON-serializable value.
   */
  public async stageCreate(key: string, value: JsonValue): Promise<void> {
    stageCreateInArea(this.staging, key, value);
  }

  /**
   * Retrieve the JSON value stored under `key`. Reflects any pending
   * staged change for `key` ahead of the committed state.
   *
   * @param key The record key.
   * @returns A {@link RetrieveResult}.
   */
  public async retrieve(key: string): Promise<RetrieveResult> {
    const branch = await this.resolveBranch();
    return retrieveRecord(this.makeRetrieveContext(branch), key);
  }

  /**
   * Stage an update of an existing JSON record under `key`.
   *
   * @param key The record key.
   * @param value The new JSON value.
   */
  public async stageUpdate(key: string, value: JsonValue): Promise<void> {
    stageUpdateInArea(this.staging, key, value);
  }

  /**
   * Stage the deletion of the record under `key`.
   *
   * @param key The record key.
   */
  public async stageDelete(key: string): Promise<void> {
    stageDeleteInArea(this.staging, key);
  }

  /**
   * Return a snapshot list of every pending Staged Operation in the
   * instance's staging area.
   *
   * @returns A shallow copy of the staged operations.
   */
  public listStaged(): StagedOperation[] {
    return listStaged(this.staging);
  }

  /**
   * Discard all staged operations without contacting GitHub.
   */
  public reset(): void {
    this.staging.clear();
  }

  /**
   * Apply all staged operations atomically as a single commit on the
   * working branch.
   *
   * @param options Per-commit options (message + optional conflict policy).
   * @returns A {@link CommitResult}.
   */
  public async commit(options: CommitOptions): Promise<CommitResult> {
    const branch = await this.resolveBranch();
    return runCommit(
      {
        octokit: this.octokit,
        config: this.config,
        staging: this.staging,
        cachedTip: this.cachedTip,
        branch,
      },
      options,
    );
  }

  /**
   * Force-update the working branch tip to the parent commit of the
   * current tip.
   */
  public async rollback(): Promise<void> {
    const branch = await this.resolveBranch();
    await runRollback({
      octokit: this.octokit,
      config: this.config,
      staging: this.staging,
      cachedTip: this.cachedTip,
      branch,
    });
  }

  /**
   * Refresh the instance's cached working-branch tip without performing
   * a read.
   *
   * @returns The new cached tip SHA.
   */
  public async refresh(): Promise<string> {
    const branch = await this.resolveBranch();
    return refreshTipSha(this.makeRetrieveContext(branch));
  }

  /**
   * Register a webhook on the configured repository.
   *
   * @param options See {@link WebhookSubscriptionOptions}.
   * @returns A {@link WebhookSubscription}.
   */
  public async subscribeWebhook(
    options: WebhookSubscriptionOptions,
  ): Promise<WebhookSubscription> {
    return subscribeWebhook(this.octokit, this.config.owner, this.config.repo, options);
  }

  /**
   * List all webhooks currently registered on the configured repository.
   *
   * @returns An array of {@link WebhookSubscription}.
   */
  public async listWebhooks(): Promise<WebhookSubscription[]> {
    return listWebhooks(this.octokit, this.config.owner, this.config.repo);
  }

  /**
   * Remove a webhook from the configured repository by GitHub's hook id.
   *
   * @param id GitHub's hook id.
   * @returns Resolves when the webhook has been deleted.
   */
  public async unsubscribeWebhook(id: number): Promise<void> {
    return unsubscribeWebhook(this.octokit, this.config.owner, this.config.repo, id);
  }

  /**
   * Resolve the working branch, fetching the repo's default branch on
   * first use when none was provided.
   *
   * @returns The resolved working-branch name.
   */
  private async resolveBranch(): Promise<string> {
    if (this.resolvedBranch !== undefined) return this.resolvedBranch;
    try {
      const resp = await this.octokit.request('GET /repos/{owner}/{repo}', {
        owner: this.config.owner,
        repo: this.config.repo,
      });
      const branch = (resp.data as { default_branch?: string }).default_branch;
      if (typeof branch !== 'string' || branch.length === 0) {
        throw new Error('GitHub did not return a default branch.');
      }
      this.resolvedBranch = branch;
      return branch;
    } catch (err) {
      throw toGhDbError(err);
    }
  }

  /**
   * Build the {@link RetrieveContext} shared between `retrieve` and
   * `refresh`.
   *
   * @param branch The resolved working branch.
   * @returns The context object.
   */
  private makeRetrieveContext(branch: string): RetrieveContext {
    return {
      octokit: this.octokit,
      config: this.config,
      staging: this.staging,
      cachedTip: this.cachedTip,
      branch,
    };
  }
}
