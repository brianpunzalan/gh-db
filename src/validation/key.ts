import { KeyValidationError } from '../errors/index.js';

// Reject ASCII control characters (NUL–US and DEL). These control characters
// are matched intentionally, so the no-control-regex rule does not apply here.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;

/**
 * Validate a record key against the format rules from FR-005a.
 *
 * A key MUST be a non-empty, non-whitespace-only string with no
 * forward-slash, backslash, or control characters, and MUST NOT be
 * exactly `'.'` or `'..'`. The dot rules guard against path-traversal
 * tricks against the on-disk file naming convention (`{key}.json`).
 *
 * @param key Caller-supplied key string.
 * @throws {KeyValidationError} when `key` fails any of the format rules.
 */
export function validateKey(key: unknown): asserts key is string {
  if (typeof key !== 'string') {
    throw new KeyValidationError('Key must be a string.', {
      key: String(key),
    });
  }
  if (key.length === 0) {
    throw new KeyValidationError('Key must be non-empty.', { key });
  }
  if (key.trim().length === 0) {
    throw new KeyValidationError('Key must not be whitespace-only.', { key });
  }
  if (key === '.' || key === '..') {
    throw new KeyValidationError(`Key must not be '${key}'.`, { key });
  }
  if (key.includes('/') || key.includes('\\')) {
    throw new KeyValidationError('Key must not contain forward-slash or backslash characters.', {
      key,
    });
  }
  if (CONTROL_CHAR_REGEX.test(key)) {
    throw new KeyValidationError('Key must not contain control characters.', { key });
  }
}
