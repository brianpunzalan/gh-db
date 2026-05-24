import { encodeJson } from '../serialization/encode.js';
import { collapseOperation } from '../staging/collapse.js';
import type { StagingArea } from '../staging/staging-area.js';
import { validateKey } from '../validation/key.js';
import type { JsonValue } from '../types/public.js';

/**
 * Stage an update of an existing JSON record.
 *
 * Validates key + value, then layers the `update` through the collapse
 * rules. Existence in the committed state is validated lazily at commit
 * time — the collapse rules cover staging-area cases (no-op on a
 * pending delete is rejected by the rules).
 *
 * @param area The staging area.
 * @param key The record's key.
 * @param value The new JSON value.
 */
export function stageUpdateInArea(
  area: StagingArea,
  key: string,
  value: JsonValue,
): void {
  validateKey(key);
  encodeJson(key, value);
  const result = collapseOperation(area.get(key), 'update', key, value);
  if (result.kind === 'set') {
    area.set(result.op);
  } else {
    area.delete(key);
  }
}
