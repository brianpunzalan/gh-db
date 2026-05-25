import { describe, expect, it } from 'vitest';
import { KeyValidationError, StagingError } from '../../../src/errors/index.js';
import { stageDeleteInArea } from '../../../src/crud/delete.js';
import { makeStagedOperation, StagingArea } from '../../../src/staging/staging-area.js';

describe('stageDelete', () => {
  it('stages a delete op for a valid key', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('update', 'alice', { x: 1 }));
    stageDeleteInArea(area, 'alice');
    expect(area.get('alice')?.kind).toBe('delete');
  });

  it('rejects invalid key', () => {
    expect(() => stageDeleteInArea(new StagingArea(), 'a/b')).toThrow(KeyValidationError);
  });

  it('collapses create+delete into remove (no commit entry)', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('create', 'alice', { x: 1 }));
    stageDeleteInArea(area, 'alice');
    expect(area.get('alice')).toBeUndefined();
    expect(area.size()).toBe(0);
  });

  it('rejects delete on a pending delete', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('delete', 'alice'));
    expect(() => stageDeleteInArea(area, 'alice')).toThrow(StagingError);
  });

  it('collapses update+delete → delete', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('update', 'alice', { x: 1 }));
    stageDeleteInArea(area, 'alice');
    expect(area.get('alice')?.kind).toBe('delete');
    expect(area.get('alice')?.value).toBeUndefined();
  });
});
