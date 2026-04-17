import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config', () => ({
  config: { server: { sessionSecret: 'test-oauth-signing-secret' } },
}));

import { encodeOAuthState, decodeOAuthState } from '../../src/utils/oauth-state';

describe('OAuth state signing', () => {
  it('round-trips a payload with workspaceId and userId', () => {
    const state = encodeOAuthState({ workspaceId: 'W1', userId: 'U1' });
    const decoded = decodeOAuthState(state);
    expect(decoded.workspaceId).toBe('W1');
    expect(decoded.userId).toBe('U1');
    expect(decoded.nonce).toBeTruthy();
    expect(decoded.expiresAt).toBeGreaterThan(Date.now());
  });

  it('round-trips optional returnTo and extra', () => {
    const state = encodeOAuthState({ workspaceId: 'W1', userId: 'U1', returnTo: '/connections', extra: { tool: 'linear' } });
    const decoded = decodeOAuthState(state);
    expect(decoded.returnTo).toBe('/connections');
    expect(decoded.extra).toEqual({ tool: 'linear' });
  });

  it('rejects a tampered signature', () => {
    const state = encodeOAuthState({ workspaceId: 'W1', userId: 'U1' });
    const [body] = state.split('.');
    const tampered = `${body}.not-the-real-signature`;
    expect(() => decodeOAuthState(tampered)).toThrow(/signature/i);
  });

  it('rejects tampered body', () => {
    const state = encodeOAuthState({ workspaceId: 'W1', userId: 'U1' });
    const [, sig] = state.split('.');
    const tampered = `${Buffer.from('{"workspaceId":"W_OTHER","userId":"U1","nonce":"x","expiresAt":9999999999999}').toString('base64url')}.${sig}`;
    expect(() => decodeOAuthState(tampered)).toThrow(/signature/i);
  });

  it('rejects malformed state', () => {
    expect(() => decodeOAuthState('')).toThrow();
    expect(() => decodeOAuthState('no-dot')).toThrow();
  });
});
