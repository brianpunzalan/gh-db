import { describe, expect, it } from 'vitest';
import { makeStagedOperation, StagingArea } from '../../../src/staging/staging-area.js';

describe('StagingArea', () => {
  it('starts empty with undefined baseline', () => {
    const a = new StagingArea();
    expect(a.isEmpty()).toBe(true);
    expect(a.size()).toBe(0);
    expect(a.baselineSha).toBeUndefined();
    expect(a.baselineTreeSha).toBeUndefined();
  });

  it('records an op via set() and retrieves it via get()', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'alice', { x: 1 }));
    expect(a.size()).toBe(1);
    expect(a.get('alice')?.kind).toBe('create');
  });

  it('all() returns a shallow copy that callers may mutate', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'alice', { x: 1 }));
    const out = a.all();
    out.push({ kind: 'delete', key: 'extra', enqueuedAt: new Date() });
    expect(a.size()).toBe(1);
  });

  it('captureBaseline sets fields exactly once', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'k', { x: 1 }));
    a.captureBaseline('sha1', 'tree1');
    expect(a.baselineSha).toBe('sha1');
    expect(a.baselineTreeSha).toBe('tree1');
    a.captureBaseline('sha2', 'tree2');
    expect(a.baselineSha).toBe('sha1');
  });

  it('clear() empties the map and clears the baseline', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'k', { x: 1 }));
    a.captureBaseline('sha', 'tree');
    a.clear();
    expect(a.isEmpty()).toBe(true);
    expect(a.baselineSha).toBeUndefined();
  });

  it('delete() removes one op and clears baseline when empty', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'k', { x: 1 }));
    a.captureBaseline('sha', 'tree');
    a.delete('k');
    expect(a.size()).toBe(0);
    expect(a.baselineSha).toBeUndefined();
  });

  it('delete() preserves baseline when other ops remain', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'k1', { x: 1 }));
    a.set(makeStagedOperation('create', 'k2', { x: 2 }));
    a.captureBaseline('sha', 'tree');
    a.delete('k1');
    expect(a.baselineSha).toBe('sha');
  });
});
