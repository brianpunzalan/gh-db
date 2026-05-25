import { describe, expect, it } from 'vitest';
import { buildTreeEntries, type BlobShaMap } from '../../../src/commit/tree-builder.js';
import type { StagedOperation } from '../../../src/types/public.js';

function op(kind: 'create' | 'update' | 'delete', key: string): StagedOperation {
  return { kind, key, enqueuedAt: new Date(), ...(kind !== 'delete' ? { value: {} } : {}) };
}

describe('buildTreeEntries', () => {
  it('creates entries with sha for create/update ops', () => {
    const ops = [op('create', 'alice'), op('update', 'bob')];
    const blobs: BlobShaMap = new Map([
      ['alice', 'sha-alice'],
      ['bob', 'sha-bob'],
    ]);
    const entries = buildTreeEntries(ops, blobs);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      path: 'alice.json',
      mode: '100644',
      type: 'blob',
      sha: 'sha-alice',
    });
    expect(entries[1]).toEqual({
      path: 'bob.json',
      mode: '100644',
      type: 'blob',
      sha: 'sha-bob',
    });
  });

  it('sets sha=null for delete ops', () => {
    const ops = [op('delete', 'carol')];
    const entries = buildTreeEntries(ops, new Map());
    expect(entries[0]!.sha).toBeNull();
  });

  it('returns entries in sorted key order for determinism', () => {
    const ops = [op('create', 'zebra'), op('create', 'alpha')];
    const blobs: BlobShaMap = new Map([
      ['zebra', 'sz'],
      ['alpha', 'sa'],
    ]);
    const entries = buildTreeEntries(ops, blobs);
    expect(entries[0]!.path).toBe('alpha.json');
    expect(entries[1]!.path).toBe('zebra.json');
  });

  it('throws when blob SHA is missing for a create/update', () => {
    const ops = [op('create', 'alice')];
    expect(() => buildTreeEntries(ops, new Map())).toThrow();
  });

  it('preserves only .json entries in the tree request', () => {
    const ops = [op('update', 'data')];
    const blobs: BlobShaMap = new Map([['data', 'sha-data']]);
    const entries = buildTreeEntries(ops, blobs);
    expect(entries.every((e) => e.path.endsWith('.json'))).toBe(true);
  });
});
