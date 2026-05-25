import { describe, expect, it } from 'vitest';
import { GhDb } from '../../../src/core/gh-db.js';
import { StagingError } from '../../../src/errors/index.js';

describe('retrieve', () => {
  it('returns staged create value without network', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('alice', { name: 'Alice' });
    const out = await db.retrieve('alice');
    expect(out).toEqual({ found: true, value: { name: 'Alice' } });
  });

  it('returns { found: false } for staged deletes', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('alice', { name: 'Alice' });
    await db.stageDelete('alice');
    // create + delete cancels out — key becomes absent
    expect(db.listStaged()).toHaveLength(0);
  });
});

describe('staging lifecycle', () => {
  it('stageCreate + stageUpdate collapses to create with last value', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    await db.stageUpdate('k', { v: 2 });
    const staged = db.listStaged();
    expect(staged).toHaveLength(1);
    expect(staged[0]!.kind).toBe('create');
    expect(staged[0]!.value).toEqual({ v: 2 });
  });

  it('reset clears all staged ops', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('a', { v: 1 });
    await db.stageCreate('b', { v: 2 });
    db.reset();
    expect(db.listStaged()).toHaveLength(0);
  });

  it('duplicate stageCreate throws StagingError', async () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't', branch: 'main' });
    await db.stageCreate('k', { v: 1 });
    await expect(db.stageCreate('k', { v: 2 })).rejects.toBeInstanceOf(StagingError);
  });
});
