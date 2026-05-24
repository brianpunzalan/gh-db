import { describe, expect, it } from 'vitest';
import { KeyValidationError, SerializationError, StagingError } from '../../../src/errors/index.js';
import { stageUpdateInArea } from '../../../src/crud/update.js';
import { makeStagedOperation, StagingArea } from '../../../src/staging/staging-area.js';

describe('stageUpdate', () => {
  it('stages an update op for a valid key + value', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('create', 'alice', { x: 1 }));
    stageUpdateInArea(area, 'alice', { x: 2 });
    expect(area.get('alice')?.kind).toBe('create');
    expect(area.get('alice')?.value).toEqual({ x: 2 });
  });

  it('rejects invalid key', () => {
    expect(() => stageUpdateInArea(new StagingArea(), '..', { x: 1 })).toThrow(
      KeyValidationError,
    );
  });

  it('rejects non-JSON-serializable value', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('update', 'alice', { x: 1 }));
    expect(() => stageUpdateInArea(area, 'alice', undefined as never)).toThrow(
      SerializationError,
    );
  });

  it('collapses update+update into latest-value update', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('update', 'alice', { x: 1 }));
    stageUpdateInArea(area, 'alice', { x: 99 });
    expect(area.get('alice')?.value).toEqual({ x: 99 });
  });

  it('rejects update on a pending delete', () => {
    const area = new StagingArea();
    area.set(makeStagedOperation('delete', 'alice'));
    expect(() => stageUpdateInArea(area, 'alice', { x: 1 })).toThrow(StagingError);
  });
});
