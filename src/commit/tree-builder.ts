import type { StagedOperation } from '../types/public.js';

/** A single entry in a GitHub tree-creation request. */
export interface TreeEntry {
  /** On-repo path (gh-db uses `<key>.json`). */
  path: string;
  /** UNIX file mode (`'100644'` for blobs). */
  mode: '100644';
  /** Object type. */
  type: 'blob';
  /** Blob SHA for create/update; null to remove the path from the tree. */
  sha: string | null;
}

/** Mapping from record key → blob SHA produced by the commit pipeline. */
export type BlobShaMap = Map<string, string>;

/**
 * Compose the `tree` array entries for a GitHub tree-creation request.
 *
 * Creates / updates produce entries with `sha = <blobSha>`; deletes
 * produce entries with `sha = null` (GitHub's documented mechanism for
 * removing a path from a tree). Untouched entries are inherited from
 * the request's `base_tree`.
 *
 * @param ops Ordered staged operations.
 * @param blobShas Map from key → blob SHA for create/update entries.
 * @returns The tree entries array (in deterministic key order).
 */
export function buildTreeEntries(ops: StagedOperation[], blobShas: BlobShaMap): TreeEntry[] {
  const entries: TreeEntry[] = [];
  // Deterministic ordering keeps test fixtures stable and makes diffs
  // reproducible across runs.
  const sorted = [...ops].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const op of sorted) {
    const path = `${op.key}.json`;
    if (op.kind === 'delete') {
      entries.push({ path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const sha = blobShas.get(op.key);
    if (sha === undefined) {
      // Defensive: blob SHAs must be supplied for every create/update.
      // We throw here rather than silently dropping the entry, which
      // would cause data loss in the commit.
      throw new Error(`Internal: missing blob SHA for staged ${op.kind} key '${op.key}'.`);
    }
    entries.push({ path, mode: '100644', type: 'blob', sha });
  }
  return entries;
}
