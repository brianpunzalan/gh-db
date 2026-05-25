import type { JsonValue, StagedOperation, StagedOperationKind } from '../types/public.js';

/**
 * In-memory staging area for one {@link GhDb} instance.
 *
 * Maintains a key-indexed map of pending operations plus the staging
 * baseline (the tip + tree SHAs captured when the first op enters an
 * otherwise-empty area). Baseline is cleared when the area becomes
 * empty (R-014).
 */
export class StagingArea {
  private readonly ops: Map<string, StagedOperation> = new Map<string, StagedOperation>();
  private _baselineSha: string | undefined;
  private _baselineTreeSha: string | undefined;

  /**
   * Add or replace the operation for `key`. Callers MUST run collapse
   * rules (see `staging/collapse.ts`) before invoking this — this method
   * stores the resolved op as-is.
   *
   * @param op The staged operation to record (or replace).
   */
  public set(op: StagedOperation): void {
    this.ops.set(op.key, op);
  }

  /**
   * Remove the operation for `key` (used by collapse rules that cancel
   * an op out, e.g. create+delete).
   *
   * @param key Record key.
   */
  public delete(key: string): void {
    this.ops.delete(key);
    if (this.ops.size === 0) {
      this._baselineSha = undefined;
      this._baselineTreeSha = undefined;
    }
  }

  /**
   * Look up the pending operation for `key`.
   *
   * @param key Record key.
   * @returns The staged operation or undefined when none is pending.
   */
  public get(key: string): StagedOperation | undefined {
    return this.ops.get(key);
  }

  /**
   * Whether the staging area has zero pending operations.
   *
   * @returns True when the area is empty.
   */
  public isEmpty(): boolean {
    return this.ops.size === 0;
  }

  /**
   * Number of pending operations.
   *
   * @returns The current size.
   */
  public size(): number {
    return this.ops.size;
  }

  /**
   * Snapshot the staged operations as an array of shallow copies.
   * Callers may mutate the array freely.
   *
   * @returns Array of pending operations.
   */
  public all(): StagedOperation[] {
    return Array.from(this.ops.values()).map((op) => ({
      kind: op.kind,
      key: op.key,
      ...(op.value !== undefined ? { value: op.value } : {}),
      enqueuedAt: op.enqueuedAt,
    }));
  }

  /**
   * Discard every pending operation and clear the baseline.
   */
  public clear(): void {
    this.ops.clear();
    this._baselineSha = undefined;
    this._baselineTreeSha = undefined;
  }

  /**
   * Capture the baseline tip + tree SHAs (idempotent — only the first
   * call after the area becomes non-empty actually sets them).
   *
   * @param sha Working-branch tip commit SHA.
   * @param treeSha Tree SHA reachable from `sha`.
   */
  public captureBaseline(sha: string, treeSha: string): void {
    if (this._baselineSha === undefined) {
      this._baselineSha = sha;
      this._baselineTreeSha = treeSha;
    }
  }

  /**
   * Currently-captured baseline tip SHA, if any.
   *
   * @returns The baseline tip SHA, or `undefined` if not yet captured.
   */
  public get baselineSha(): string | undefined {
    return this._baselineSha;
  }

  /**
   * Currently-captured baseline tree SHA, if any.
   *
   * @returns The baseline tree SHA, or `undefined` if not yet captured.
   */
  public get baselineTreeSha(): string | undefined {
    return this._baselineTreeSha;
  }
}

/**
 * Construct a fresh {@link StagedOperation} value with the current wall-
 * clock timestamp.
 *
 * @param kind Operation kind.
 * @param key Record key.
 * @param value Optional value (omitted for `'delete'`).
 * @returns A new staged operation object.
 */
export function makeStagedOperation(
  kind: StagedOperationKind,
  key: string,
  value?: JsonValue,
): StagedOperation {
  return {
    kind,
    key,
    ...(value !== undefined ? { value } : {}),
    enqueuedAt: new Date(),
  };
}
