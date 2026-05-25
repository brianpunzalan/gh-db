import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/errors/index.js';
import { subscribeWebhook } from '../../../src/webhooks/subscribe.js';
import { Octokit } from '@octokit/rest';

describe('subscribeWebhook validation', () => {
  const octokit = new Octokit({ auth: 'test' });

  it('rejects when events is empty array', async () => {
    await expect(
      subscribeWebhook(octokit, 'o', 'r', {
        callbackUrl: 'https://example.com/hook',
        events: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when events contains empty string', async () => {
    await expect(
      subscribeWebhook(octokit, 'o', 'r', {
        callbackUrl: 'https://example.com/hook',
        events: ['push', ''],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects invalid callbackUrl', async () => {
    await expect(
      subscribeWebhook(octokit, 'o', 'r', {
        callbackUrl: 'not-a-url',
        events: ['push'],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects empty callbackUrl', async () => {
    await expect(
      subscribeWebhook(octokit, 'o', 'r', {
        callbackUrl: '',
        events: ['push'],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('validates events array has at least one non-empty string', async () => {
    await expect(
      subscribeWebhook(octokit, 'o', 'r', {
        callbackUrl: 'https://example.com/hook',
        events: ['push'],
      }),
    ).rejects.not.toBeInstanceOf(ValidationError);
  });
});
