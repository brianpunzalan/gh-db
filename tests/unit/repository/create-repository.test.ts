import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/errors/index.js';
import { createRepository } from '../../../src/repository/create-repository.js';
import { Octokit } from '@octokit/rest';

describe('createRepository validation', () => {
  const octokit = new Octokit({ auth: 'test' });

  it('rejects empty name', async () => {
    await expect(
      createRepository(octokit, { name: '', visibility: 'private' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects invalid visibility', async () => {
    await expect(
      createRepository(octokit, { name: 'x', visibility: 'unknown' as never }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
