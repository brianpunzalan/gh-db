import { encodeJson } from '../serialization/encode.js';
import { collapseOperation } from '../staging/collapse.js';
import type { StagingArea } from '../staging/staging-area.js';
import { validateKey } from '../validation/key.js';
import type { JsonValue } from '../types/public.js';

/**
 * Stage the creation of a JSON record under `key`.
 *
 * Validates key + value format first (eager fail), then layers the new
 * `create` op through the collapse rules. The on-repo existence check
 * is intentionally deferred to commit time (see contracts/public-api.md
 * "Method-call contracts" — gh-db validates lazily against the cached
 * tree to avoid extra round-trips for every staging call). The collapse
 * rules cover the *intra-staging* duplicate-create case.
 *
 * @param area The staging area.
 * @param key The new record's key.
 * @param value The record's JSON value.
 */
export function stageCreateInArea(
  area: StagingArea,
  key: string,
  value: JsonValue,
): void {
  validateKey(key);
  // Validate JSON-encodability eagerly; encodeJson throws
  // SerializationError on circular/unsupported/undefined-top-level.
  encodeJson(key, value);
  const result = collapseOperation(area.get(key), 'create', key, value);
  if (result.kind === 'set') {
    area.set(result.op);
  } else {
    area.delete(key);
  }
}
