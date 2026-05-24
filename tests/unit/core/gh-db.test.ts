import { describe, expect, it } from 'vitest';
import { GhDb } from '../../../src/core/gh-db.js';

describe('GhDb constructor', () => {
  it('constructs without contacting GitHub', () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't' });
    expect(db).toBeInstanceOf(GhDb);
  });

  it('starts with an empty staging area', () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't' });
    expect(db.listStaged()).toEqual([]);
  });

  it('throws on missing required fields', () => {
    expect(() => new GhDb({ owner: '', repo: 'r', auth: 't' })).toThrow();
    expect(() => new GhDb({ owner: 'o', repo: '', auth: 't' })).toThrow();
    expect(() => new GhDb({ owner: 'o', repo: 'r', auth: '' })).toThrow();
  });

  it('exposes the full method surface', () => {
    const db = new GhDb({ owner: 'o', repo: 'r', auth: 't' });
    expect(typeof db.stageCreate).toBe('function');
    expect(typeof db.stageUpdate).toBe('function');
    expect(typeof db.stageDelete).toBe('function');
    expect(typeof db.retrieve).toBe('function');
    expect(typeof db.commit).toBe('function');
    expect(typeof db.rollback).toBe('function');
    expect(typeof db.refresh).toBe('function');
    expect(typeof db.reset).toBe('function');
    expect(typeof db.listStaged).toBe('function');
    expect(typeof db.createRepository).toBe('function');
    expect(typeof db.subscribeWebhook).toBe('function');
    expect(typeof db.listWebhooks).toBe('function');
    expect(typeof db.unsubscribeWebhook).toBe('function');
  });
});
