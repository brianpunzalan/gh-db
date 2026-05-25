import { describe, expect, it } from 'vitest';
import { GhDb } from '../../../src/core/gh-db.js';
import { RollbackError } from '../../../src/errors/index.js';

describe('rollback', () => {
  it('refuses when staging is non-empty (staging_not_empty)', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    await expect(db.rollback()).rejects.toBeInstanceOf(RollbackError);
    try {
      await db.rollback();
    } catch (err) {
      expect((err as RollbackError).reason).toBe('staging_not_empty');
    }
  });
});
