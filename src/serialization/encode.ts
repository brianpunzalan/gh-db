import { SerializationError, type SerializationReason } from '../errors/index.js';
import type { JsonValue } from '../types/public.js';

/**
 * Encode a JsonValue as pretty-printed UTF-8 JSON for on-repo storage.
 *
 * Pretty-printing (2-space indent) makes github.com diffs human-readable,
 * which is half the appeal of using a repo as a datastore. Validation
 * here runs *before* the operation enters the staging area so callers
 * fail fast (FR-009).
 *
 * @param key The record key (used only for error context).
 * @param value The caller-supplied JSON value.
 * @returns The serialized UTF-8 string.
 * @throws {SerializationError} when `value` is not JSON-encodable
 *   (circular reference, function/`BigInt`, top-level `undefined`).
 */
export function encodeJson(key: string, value: unknown): string {
  if (value === undefined) {
    throw new SerializationError('Value is undefined at the top level.', {
      key,
      reason: 'undefined_top_level',
    });
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value as JsonValue, null, 2);
  } catch (err) {
    // JSON.stringify throws TypeError on circular references and on
    // BigInt; we classify both as serialization failures and surface
    // the reason explicitly so callers can decide whether the value is
    // recoverable.
    const reason: SerializationReason = isCircularError(err) ? 'circular' : 'unsupported_type';
    throw new SerializationError(
      reason === 'circular'
        ? 'Value contains a circular reference.'
        : 'Value contains an unsupported type (e.g., BigInt or function).',
      { key, reason, cause: err },
    );
  }
  if (serialized === undefined) {
    // JSON.stringify returns undefined when the input itself is
    // undefined or a function — both are unsupported top-level values.
    throw new SerializationError('Value is not JSON-representable at the top level.', {
      key,
      reason: 'undefined_top_level',
    });
  }
  return serialized;
}

/**
 * Heuristic: detect "circular structure" TypeErrors thrown by
 * `JSON.stringify`.
 *
 * @param err The thrown error.
 * @returns True when the error message indicates a circular reference.
 */
function isCircularError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  return /circular|cyclic/i.test(err.message);
}
