import type { StagedOperation } from '../types/public.js';
import type { StagingArea } from './staging-area.js';

/**
 * Snapshot the staging area as an array of shallow copies, suitable for
 * callers to inspect via {@link GhDb.listStaged}.
 *
 * @param area The staging area to snapshot.
 * @returns An array of {@link StagedOperation} (a shallow copy).
 */
export function listStaged(area: StagingArea): StagedOperation[] {
  return area.all();
}
