import { describe, expect, it } from 'vitest';
import { StagingError } from '../../../src/errors/index.js';
import { collapseOperation } from '../../../src/staging/collapse.js';
import { makeStagedOperation } from '../../../src/staging/staging-area.js';
import type { StagedOperationKind } from '../../../src/types/public.js';

function existing(kind: StagedOperationKind, value?: unknown) {
  return makeStagedOperation(kind, 'k', value as never);
}

describe('collapseOperation', () => {
  describe('(none) + ...', () => {
    it('create → create', () => {
      const r = collapseOperation(undefined, 'create', 'k', { v: 1 });
      expect(r.kind).toBe('set');
      if (r.kind === 'set') {
        expect(r.op.kind).toBe('create');
        expect(r.op.value).toEqual({ v: 1 });
      }
    });
    it('update → update (existence validated elsewhere)', () => {
      const r = collapseOperation(undefined, 'update', 'k', { v: 2 });
      expect(r.kind).toBe('set');
    });
    it('delete → delete', () => {
      const r = collapseOperation(undefined, 'delete', 'k', undefined);
      expect(r.kind).toBe('set');
    });
  });

  describe('create + ...', () => {
    it('create + create → StagingError', () => {
      expect(() =>
        collapseOperation(existing('create', { v: 1 }), 'create', 'k', { v: 2 }),
      ).toThrow(StagingError);
    });
    it('create + update → create (with new value)', () => {
      const r = collapseOperation(existing('create', { v: 1 }), 'update', 'k', { v: 2 });
      if (r.kind !== 'set') throw new Error('expected set');
      expect(r.op.kind).toBe('create');
      expect(r.op.value).toEqual({ v: 2 });
    });
    it('create + delete → removed', () => {
      const r = collapseOperation(existing('create', { v: 1 }), 'delete', 'k', undefined);
      expect(r.kind).toBe('remove');
    });
  });

  describe('update + ...', () => {
    it('update + create → StagingError', () => {
      expect(() =>
        collapseOperation(existing('update', { v: 1 }), 'create', 'k', { v: 2 }),
      ).toThrow(StagingError);
    });
    it('update + update → update (latest value)', () => {
      const r = collapseOperation(existing('update', { v: 1 }), 'update', 'k', { v: 2 });
      if (r.kind !== 'set') throw new Error('expected set');
      expect(r.op.kind).toBe('update');
      expect(r.op.value).toEqual({ v: 2 });
    });
    it('update + delete → delete', () => {
      const r = collapseOperation(existing('update', { v: 1 }), 'delete', 'k', undefined);
      if (r.kind !== 'set') throw new Error('expected set');
      expect(r.op.kind).toBe('delete');
    });
  });

  describe('delete + ...', () => {
    it('delete + create → update (with create value)', () => {
      const r = collapseOperation(existing('delete'), 'create', 'k', { v: 3 });
      if (r.kind !== 'set') throw new Error('expected set');
      expect(r.op.kind).toBe('update');
      expect(r.op.value).toEqual({ v: 3 });
    });
    it('delete + update → StagingError', () => {
      expect(() => collapseOperation(existing('delete'), 'update', 'k', { v: 1 })).toThrow(
        StagingError,
      );
    });
    it('delete + delete → StagingError', () => {
      expect(() => collapseOperation(existing('delete'), 'delete', 'k', undefined)).toThrow(
        StagingError,
      );
    });
  });
});
