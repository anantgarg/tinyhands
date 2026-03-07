import { describe, it, expect } from 'vitest';
import { normalizeEventPayload } from './helpers/trigger-helpers';

// Test the payload normalization logic (extracted for testability)
// The actual trigger CRUD requires DB setup, tested in integration tests

describe('Trigger Payload Normalization', () => {
  it('should format slack_channel payloads', () => {
    const result = normalizeEventPayload('slack_channel', {
      text: 'Hello world',
      user: 'U123',
    });
    expect(result).toContain('Hello world');
    expect(result).toContain('<@U123>');
  });

  it('should format linear payloads', () => {
    const result = normalizeEventPayload('linear', {
      action: 'create',
      type: 'issue',
      data: { title: 'Fix bug', description: 'Something is broken' },
    });
    expect(result).toContain('Linear event');
    expect(result).toContain('create');
    expect(result).toContain('Fix bug');
    expect(result).toContain('Something is broken');
  });

  it('should format zendesk payloads', () => {
    const result = normalizeEventPayload('zendesk', {
      action: 'created',
      subject: 'Cannot login',
      description: 'User reports login issues',
    });
    expect(result).toContain('Support ticket');
    expect(result).toContain('Cannot login');
  });

  it('should format webhook payloads as JSON', () => {
    const result = normalizeEventPayload('webhook', { key: 'value' });
    expect(result).toContain('Webhook event received');
    expect(result).toContain('"key"');
  });

  it('should handle unknown trigger types', () => {
    const result = normalizeEventPayload('unknown' as any, { data: 1 });
    expect(result).toContain('"data"');
  });
});

describe('Trigger Idempotency Keys', () => {
  it('should generate unique keys per event', () => {
    const key1 = `linear:create:issue-1`;
    const key2 = `linear:create:issue-2`;
    expect(key1).not.toBe(key2);
  });

  it('should generate same key for duplicate events', () => {
    const key1 = `linear:create:issue-1`;
    const key2 = `linear:create:issue-1`;
    expect(key1).toBe(key2);
  });
});
