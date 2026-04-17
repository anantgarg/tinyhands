import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: { observability: { logLevel: 'debug' } },
}));

import { redactSecrets } from '../../src/utils/logger';

describe('redactSecrets', () => {
  it('redacts Anthropic API keys embedded in strings', () => {
    const out = redactSecrets('Using key sk-ant-api03-abcdef0123456789 for call') as string;
    expect(out).not.toContain('sk-ant-api03-abcdef0123456789');
    expect(out).toContain('[REDACTED_SECRET]');
  });

  it('redacts Slack bot and user tokens', () => {
    const out = redactSecrets('xoxb-123456789012-abcdefg and xoxp-987654321098-hijklmn') as string;
    expect(out).not.toContain('xoxb-123456789012-abcdefg');
    expect(out).not.toContain('xoxp-987654321098-hijklmn');
  });

  it('redacts known-secret field names regardless of value shape', () => {
    const out = redactSecrets({
      workspaceId: 'W1',
      api_key: 'any-value-here',
      bot_token: 'xoxb-123',
      nested: { access_token: 'opaque' },
    }) as Record<string, any>;
    expect(out.workspaceId).toBe('W1');
    expect(out.api_key).toBe('[REDACTED_SECRET]');
    expect(out.bot_token).toBe('[REDACTED_SECRET]');
    expect(out.nested.access_token).toBe('[REDACTED_SECRET]');
  });

  it('preserves non-secret content unchanged', () => {
    const input = { agentId: 'A1', message: 'no secrets here' };
    expect(redactSecrets(input)).toEqual(input);
  });

  it('walks into arrays', () => {
    const out = redactSecrets(['keep', 'sk-ant-api03-leak00000']) as string[];
    expect(out[0]).toBe('keep');
    expect(out[1]).toContain('[REDACTED_SECRET]');
  });

  it('stops recursing after max depth instead of blowing up', () => {
    const cyclic: any = { workspaceId: 'W1' };
    let cur = cyclic;
    for (let i = 0; i < 20; i++) {
      cur.child = { workspaceId: 'W1' };
      cur = cur.child;
    }
    expect(() => redactSecrets(cyclic)).not.toThrow();
  });
});
