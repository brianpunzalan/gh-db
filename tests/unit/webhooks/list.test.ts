import { describe, expect, it } from 'vitest';
import { toSubscription } from '../../../src/webhooks/subscribe.js';

describe('listWebhooks mapping', () => {
  it('maps a GitHub hook response to WebhookSubscription', () => {
    const raw = {
      id: 42,
      active: true,
      events: ['push', 'create'],
      config: { url: 'https://example.com/hook' },
      last_response: { status: 'active' },
    };
    const out = toSubscription(raw);
    expect(out.id).toBe(42);
    expect(out.callbackUrl).toBe('https://example.com/hook');
    expect(out.events).toEqual(['push', 'create']);
    expect(out.active).toBe(true);
    expect(out.lastDeliveryStatus).toBe('active');
  });

  it('handles missing optional fields gracefully', () => {
    const raw = { id: 7 };
    const out = toSubscription(raw);
    expect(out.id).toBe(7);
    expect(out.callbackUrl).toBe('');
    expect(out.events).toEqual([]);
    expect(out.active).toBe(true);
    expect(out.lastDeliveryStatus).toBeUndefined();
  });
});
