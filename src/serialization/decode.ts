import { ParseError } from '../errors/index.js';
import type { JsonValue } from '../types/public.js';

/**
 * Decode a UTF-8 JSON string fetched from GitHub into its JsonValue.
 *
 * On parse failure, surfaces a typed {@link ParseError} carrying the
 * record key and the raw content size in bytes. The content itself is
 * NOT carried on the error so that sensitive data does not leak through
 * error logs (FR-006a / R-011).
 *
 * @param key The record key the content was read from.
 * @param content The raw UTF-8 string body of the file.
 * @returns The deserialized JsonValue.
 * @throws {ParseError} when `content` is not valid JSON.
 */
export function decodeJson(key: string, content: string): JsonValue {
  try {
    return JSON.parse(content) as JsonValue;
  } catch (err) {
    const contentSizeBytes = Buffer.byteLength(content, 'utf8');
    throw new ParseError(`Failed to parse JSON for key '${key}'.`, {
      key,
      contentSizeBytes,
      cause: err,
    });
  }
}
