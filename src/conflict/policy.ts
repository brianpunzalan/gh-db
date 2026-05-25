import { GhDbError } from '../errors/index.js';
import type { ConflictPolicy } from '../types/public.js';

/**
 * Resolve the conflict policy for a single commit.
 *
 * The per-call override (from `CommitOptions.conflictPolicy`) beats the
 * instance default. Returns one of the three literal values.
 *
 * @param instanceDefault The instance's default conflict policy.
 * @param perCommitOverride Optional per-commit override.
 * @returns The resolved policy.
 * @throws {GhDbError} when the override is outside the literal union.
 */
export function resolveConflictPolicy(
  instanceDefault: ConflictPolicy,
  perCommitOverride: ConflictPolicy | undefined,
): ConflictPolicy {
  if (perCommitOverride === undefined) return instanceDefault;
  if (
    perCommitOverride !== 'fail' &&
    perCommitOverride !== 'retry' &&
    perCommitOverride !== 'rebase'
  ) {
    throw new GhDbError(
      'validation',
      `Invalid 'conflictPolicy' on commit: ${String(perCommitOverride)}.`,
    );
  }
  return perCommitOverride;
}
