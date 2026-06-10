import { StagingError } from '../errors/index.js';
import type { JsonValue, StagedOperation, StagedOperationKind } from '../types/public.js';
import { makeStagedOperation } from './staging-area.js';

/** Result of applying a new operation to an existing staging-area entry. */
export type CollapseResult = { kind: 'set'; op: StagedOperation } | { kind: 'remove' };

/**
 * Compute the net effect of layering a new operation on top of an
 * existing staged operation, per the collapse table in data-model.md.
 *
 * @param existing The currently-staged op for the key, if any.
 * @param incomingKind The kind of the new op.
 * @param key The record key.
 * @param incomingValue Value carried by the new op (undefined for delete).
 * @returns Either a replacement op or a "remove" instruction.
 * @throws {StagingError} when the layering is rejected outright (e.g.,
 *   create on an existing pending create).
 */
export function collapseOperation(
  existing: StagedOperation | undefined,
  incomingKind: StagedOperationKind,
  key: string,
  incomingValue: JsonValue | undefined,
): CollapseResult {
  // (none) + create  → create
  // (none) + update  → caller validated existence externally
  // (none) + delete  → caller validated existence externally
  if (existing === undefined) {
    return { kind: 'set', op: makeStagedOperation(incomingKind, key, incomingValue) };
  }

  if (existing.kind === 'create') {
    if (incomingKind === 'create') {
      throw new StagingError(`Cannot stageCreate on key '${key}': a create is already pending.`, {
        key,
        violation: 'create_on_existing',
      });
    }
    if (incomingKind === 'update') {
      // Collapse create→update into a single create carrying the updated
      // value: there is no prior committed state to update against, so
      // the resulting commit entry is still a create.
      return {
        kind: 'set',
        op: makeStagedOperation('create', key, incomingValue),
      };
    }
    // incomingKind === 'delete' — cancels out, no commit entry.
    return { kind: 'remove' };
  }

  if (existing.kind === 'update') {
    if (incomingKind === 'create') {
      throw new StagingError(
        `Cannot stageCreate on key '${key}': record already exists (update pending).`,
        { key, violation: 'create_on_existing' },
      );
    }
    if (incomingKind === 'update') {
      // Last update wins.
      return {
        kind: 'set',
        op: makeStagedOperation('update', key, incomingValue),
      };
    }
    // incomingKind === 'delete' — switch to delete (drop the staged value).
    return { kind: 'set', op: makeStagedOperation('delete', key) };
  }

  // existing.kind === 'delete'
  if (incomingKind === 'create') {
    // delete + create → update (we ARE replacing a value that exists in
    // the committed state).
    return { kind: 'set', op: makeStagedOperation('update', key, incomingValue) };
  }
  if (incomingKind === 'update') {
    throw new StagingError(`Cannot stageUpdate on key '${key}': record is staged for deletion.`, {
      key,
      violation: 'update_on_missing',
    });
  }
  // incomingKind === 'delete'
  throw new StagingError(`Cannot stageDelete on key '${key}': delete is already pending.`, {
    key,
    violation: 'delete_on_missing',
  });
}
