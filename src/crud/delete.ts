import { collapseOperation } from '../staging/collapse.js';
import type { StagingArea } from '../staging/staging-area.js';
import { validateKey } from '../validation/key.js';

/**
 * Stage the deletion of a record by key.
 *
 * Validates key, then layers the `delete` through the collapse rules.
 * The collapse rules cancel a prior pending `create` outright (no commit
 * entry produced) and convert a pending `update` into a `delete`.
 *
 * @param area The staging area.
 * @param key The record's key.
 */
export function stageDeleteInArea(area: StagingArea, key: string): void {
  validateKey(key);
  const result = collapseOperation(area.get(key), 'delete', key, undefined);
  if (result.kind === 'set') {
    area.set(result.op);
  } else {
    area.delete(key);
  }
}
