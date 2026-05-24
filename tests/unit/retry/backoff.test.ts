import { describe, expect, it } from 'vitest';
import { computeBackoffMs, MAX_BACKOFF_MS } from '../../../src/retry/backoff.js';

describe('computeBackoffMs', () => {
  it('uses min(base * 2^attempt, 30s) ceiling with full jitter', () => {
    const random = () => 1; // produces max-but-not-inclusive of ceiling
    expect(
      computeBackoffMs({ attempt: 0, baseDelayMs: 500, random }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      computeBackoffMs({ attempt: 0, baseDelayMs: 500, random: () => 0.99 }),
    ).toBeLessThan(500);
    expect(
      computeBackoffMs({ attempt: 3, baseDelayMs: 500, random: () => 0.99 }),
    ).toBeLessThan(500 * 8);
  });

  it('caps at MAX_BACKOFF_MS (30s)', () => {
    const out = computeBackoffMs({
      attempt: 20,
      baseDelayMs: 5000,
      random: () => 0.99,
    });
    expect(out).toBeLessThan(MAX_BACKOFF_MS);
  });

  it('returns 0 with random = 0', () => {
    expect(computeBackoffMs({ attempt: 5, baseDelayMs: 500, random: () => 0 })).toBe(0);
  });

  it('honors resetAt over the computed backoff', () => {
    const now = () => 1_000_000;
    const resetAt = new Date(1_000_000 + 4000);
    const out = computeBackoffMs({
      attempt: 0,
      baseDelayMs: 500,
      random: () => 0.5,
      now,
      resetAt,
    });
    expect(out).toBe(4000);
  });

  it('clamps resetAt at MAX_BACKOFF_MS', () => {
    const now = () => 1_000_000;
    const resetAt = new Date(1_000_000 + 60_000);
    const out = computeBackoffMs({
      attempt: 0,
      baseDelayMs: 500,
      random: () => 0,
      now,
      resetAt,
    });
    expect(out).toBe(MAX_BACKOFF_MS);
  });

  it('returns 0 when resetAt is in the past', () => {
    const now = () => 1_000_000;
    const resetAt = new Date(500_000);
    const out = computeBackoffMs({
      attempt: 0,
      baseDelayMs: 500,
      now,
      resetAt,
    });
    expect(out).toBe(0);
  });
});
