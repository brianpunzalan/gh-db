import { describe, expect, it } from 'vitest';
import { GhDb } from '../../../src/core/gh-db.js';
import { ValidationError } from '../../../src/errors/index.js';

describe('commit orchestrator', () => {
  it('rejects empty message with ValidationError', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    await expect(db.commit({ message: '' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects whitespace-only message', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    await expect(db.commit({ message: '   \t\n' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects commit when staging is empty', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await expect(db.commit({ message: 'test' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('preserves staging area on commit failure paths', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    try {
      await db.commit({ message: '' });
    } catch {
      // expected
    }
    expect(db.listStaged()).toHaveLength(1);
  });
});
