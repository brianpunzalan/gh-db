import { describe, expect, it } from 'vitest';
import { listStaged } from '../../../src/staging/inspect.js';
import { makeStagedOperation, StagingArea } from '../../../src/staging/staging-area.js';

describe('listStaged', () => {
  it('returns an empty array for an empty area', () => {
    expect(listStaged(new StagingArea())).toEqual([]);
  });

  it('returns one entry per pending operation', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'alice', { name: 'A' }));
    a.set(makeStagedOperation('delete', 'bob'));
    const out = listStaged(a);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.kind)).toEqual(expect.arrayContaining(['create', 'delete']));
  });

  it('includes kind, key, value, enqueuedAt', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('update', 'alice', { name: 'Alice' }));
    const [op] = listStaged(a);
    expect(op).toBeDefined();
    expect(op!.kind).toBe('update');
    expect(op!.key).toBe('alice');
    expect(op!.value).toEqual({ name: 'Alice' });
    expect(op!.enqueuedAt).toBeInstanceOf(Date);
  });

  it('omits value for delete operations', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('delete', 'bob'));
    const [op] = listStaged(a);
    expect(op).toBeDefined();
    expect(op!.value).toBeUndefined();
  });

  it('returns a shallow copy — mutation does not affect the area', () => {
    const a = new StagingArea();
    a.set(makeStagedOperation('create', 'k', { x: 1 }));
    const out = listStaged(a);
    out.pop();
    expect(a.size()).toBe(1);
  });
});
