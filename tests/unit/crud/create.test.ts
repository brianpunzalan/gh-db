import { describe, expect, it } from 'vitest';
import { KeyValidationError, SerializationError, StagingError } from '../../../src/errors/index.js';
import { stageCreateInArea } from '../../../src/crud/create.js';
import { makeStagedOperation, StagingArea } from '../../../src/staging/staging-area.js';

describe('stageCreate', () => {
  it('stages a new create op for a valid key + value', () => {
    const area = new StagingArea();
    stageCreateInArea(area, 'alice', { name: 'Alice' });
    expect(area.get('alice')?.kind).toBe('create');
    expect(area.get('alice')?.value).toEqual({ name: 'Alice' });
  });

  it('rejects invalid key', () => {
    const area = new StagingArea();
    expect(() => stageCreateInArea(area, '', { x: 1 })).toThrow(KeyValidationError);
    expect(() => stageCreateInArea(area, 'a/b', { x: 1 })).toThrow(KeyValidationError);
  });

  it('rejects non-JSON-serializable value', () => {
    const area = new StagingArea();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => stageCreateInArea(area, 'k', circular as never)).toThrow(SerializationError);
  });

  it('rejects create when key already has a pending create', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('create', 'alice', { x: 1 }));
    expect(() => stageCreateInArea(area, 'alice', { x: 2 })).toThrow(StagingError);
  });

  it('rejects create when key has a pending update', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('update', 'alice', { x: 1 }));
    expect(() => stageCreateInArea(area, 'alice', { x: 2 })).toThrow(StagingError);
  });

  it('collapses pending delete + create into update', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('delete', 'alice'));
    stageCreateInArea(area, 'alice', { x: 3 });
    expect(area.get('alice')?.kind).toBe('update');
    expect(area.get('alice')?.value).toEqual({ x: 3 });
  });
});
