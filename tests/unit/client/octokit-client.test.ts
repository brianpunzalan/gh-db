import { describe, expect, it } from 'vitest';
import { createOctokitClient, DEFAULT_GITHUB_BASE_URL } from '../../../src/client/octokit-client.js';

describe('createOctokitClient', () => {
  it('creates an Octokit instance with the configured auth and baseUrl', () => {
    const octokit = createOctokitClient({
      auth: 'token',
      baseUrl: 'https://api.example.com',
      userAgent: 'gh-db-test/1.0',
      retryMaxAttempts: 3,
      retryBaseDelayMs: 500,
    });
    expect(octokit).toBeDefined();
    expect(typeof octokit.request).toBe('function');
  });

  it('defaults baseUrl to https://api.github.com when omitted', () => {
    const octokit = createOctokitClient({
      auth: 'token',
      userAgent: 'gh-db-test/1.0',
      retryMaxAttempts: 3,
      retryBaseDelayMs: 500,
    });
    expect(DEFAULT_GITHUB_BASE_URL).toBe('https://api.github.com');
    expect(octokit).toBeDefined();
  });

  it('exposes the request hook for retry installation', () => {
    const octokit = createOctokitClient({
      auth: 'token',
      userAgent: 'gh-db-test/1.0',
      retryMaxAttempts: 3,
      retryBaseDelayMs: 500,
    });
    expect(octokit.hook).toBeDefined();
    expect(typeof octokit.hook.wrap).toBe('function');
  });
});
