import { describe, it, expect } from 'vitest';
import { buildCredentialError, CredentialErrorContext } from '../../src/modules/connections/errors';

function makeContext(overrides: Partial<CredentialErrorContext> = {}): CredentialErrorContext {
  return {
    mode: 'team',
    integrationId: 'chargebee',
    integrationLabel: 'Chargebee',
    integrationIcon: ':chargebee:',
    runnerPlatformRole: 'member',
    runnerAgentRole: 'viewer',
    agentOwnerIds: ['U_OWNER1'],
    isRunnerOwner: false,
    isRunnerAdmin: false,
    ...overrides,
  };
}

describe('buildCredentialError', () => {
  // ── Team Mode ──

  describe('team mode', () => {
    it('should return admin message when runner is admin', () => {
      const ctx = makeContext({ mode: 'team', isRunnerAdmin: true, runnerPlatformRole: 'admin' });
      const result = buildCredentialError(ctx);
      expect(result.message).toContain('Missing shared Chargebee credentials');
      expect(result.blocks[0].text.text).toContain('Go to the *Connections* page in the dashboard');
      expect(result.showConnectButton).toBe(false);
    });

    it('should return admin message when runner is superadmin', () => {
      const ctx = makeContext({ mode: 'team', isRunnerAdmin: true, runnerPlatformRole: 'superadmin' });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('Go to the *Connections* page in the dashboard');
    });

    it('should return owner message when runner is agent owner', () => {
      const ctx = makeContext({ mode: 'team', isRunnerOwner: true, runnerAgentRole: 'owner' });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('Ask a workspace admin');
      expect(result.showConnectButton).toBe(false);
    });

    it('should return user message with owner mention for regular user', () => {
      const ctx = makeContext({ mode: 'team', agentOwnerIds: ['U_OWNER1', 'U_OWNER2'] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('<@U_OWNER1>');
      expect(result.blocks[0].text.text).toContain('<@U_OWNER2>');
      expect(result.showConnectButton).toBe(false);
    });

    it('should fall back to "a workspace admin" when no owners', () => {
      const ctx = makeContext({ mode: 'team', agentOwnerIds: [] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('a workspace admin');
    });
  });

  // ── Delegated Mode ──

  describe('delegated mode', () => {
    it('should prompt owner to connect when runner is owner', () => {
      const ctx = makeContext({ mode: 'delegated', isRunnerOwner: true, runnerAgentRole: 'owner' });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('your *Chargebee* credentials');
      expect(result.blocks[0].text.text).toContain("haven't connected");
      expect(result.showConnectButton).toBe(true);
    });

    it('should tell admin to notify the owner', () => {
      const ctx = makeContext({ mode: 'delegated', isRunnerAdmin: true, runnerPlatformRole: 'admin', agentOwnerIds: ['U_OWNER1'] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('<@U_OWNER1>');
      expect(result.blocks[0].text.text).toContain("haven't connected");
      expect(result.showConnectButton).toBe(false);
    });

    it('should tell regular user to notify the owner', () => {
      const ctx = makeContext({ mode: 'delegated', agentOwnerIds: ['U_OWNER1'] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain("owner's *Chargebee* credentials");
      expect(result.blocks[0].text.text).toContain('<@U_OWNER1>');
      expect(result.showConnectButton).toBe(false);
    });

    it('should fall back to "the agent owner" when no owners', () => {
      const ctx = makeContext({ mode: 'delegated', agentOwnerIds: [] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('the agent owner');
    });
  });

  // ── Runtime Mode ──

  describe('runtime mode', () => {
    it('should prompt the runner to connect', () => {
      const ctx = makeContext({ mode: 'runtime' });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('I need your *Chargebee* credentials');
      expect(result.showConnectButton).toBe(true);
    });

    it('should prompt admin runner to connect their own', () => {
      const ctx = makeContext({ mode: 'runtime', isRunnerAdmin: true, runnerPlatformRole: 'admin' });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('I need your *Chargebee* credentials');
      expect(result.showConnectButton).toBe(true);
    });

    it('should prompt owner runner to connect their own', () => {
      const ctx = makeContext({ mode: 'runtime', isRunnerOwner: true });
      const result = buildCredentialError(ctx);
      expect(result.showConnectButton).toBe(true);
    });
  });

  // ── Null Mode (no explicit mode set — not configured) ──

  describe('null mode (credentials not configured)', () => {
    it('should return not-configured error for regular user', () => {
      const ctx = makeContext({ mode: null });
      const result = buildCredentialError(ctx);
      expect(result.message).toContain('Chargebee credentials not configured');
      expect(result.blocks[0].text.text).toContain("haven't been configured for this agent yet");
      expect(result.blocks[0].text.text).toContain('<@U_OWNER1>');
      expect(result.showConnectButton).toBe(false);
    });

    it('should return not-configured error with settings link for admin', () => {
      const ctx = makeContext({ mode: null, isRunnerAdmin: true, runnerPlatformRole: 'admin' });
      const result = buildCredentialError(ctx);
      expect(result.message).toContain('Chargebee credentials not configured');
      expect(result.blocks[0].text.text).toContain("Open the agent's settings in the dashboard");
      expect(result.showConnectButton).toBe(false);
    });

    it('should return not-configured error with settings link for owner', () => {
      const ctx = makeContext({ mode: null, isRunnerOwner: true, runnerAgentRole: 'owner' });
      const result = buildCredentialError(ctx);
      expect(result.message).toContain('Chargebee credentials not configured');
      expect(result.blocks[0].text.text).toContain("Open the agent's settings in the dashboard");
      expect(result.showConnectButton).toBe(false);
    });

    it('should fall back to "the agent owner" when no owners for null mode', () => {
      const ctx = makeContext({ mode: null, agentOwnerIds: [] });
      const result = buildCredentialError(ctx);
      expect(result.blocks[0].text.text).toContain('the agent owner');
    });
  });

  // ── Integration label and icon ──

  it('should use the integration label and icon in messages', () => {
    const ctx = makeContext({ mode: 'team', integrationLabel: 'HubSpot', integrationIcon: ':hubspot:', isRunnerAdmin: true });
    const result = buildCredentialError(ctx);
    expect(result.blocks[0].text.text).toContain(':hubspot:');
    expect(result.blocks[0].text.text).toContain('*HubSpot*');
  });
});
