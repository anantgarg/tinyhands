import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  query: vi.fn(),
}));

vi.mock('../../src/config', () => ({
  config: {
    oauth: {
      redirectBaseUrl: 'http://localhost:3000',
    },
    encryption: {
      key: 'a]B$c9dEf0gH1iJ2kL3mN4oP5qR6sT7u',
    },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: () => 'oauth-state-uuid',
}));

vi.mock('../../src/modules/audit', () => ({
  logAuditEvent: vi.fn(),
}));

const mockCreatePersonalConnection = vi.fn().mockResolvedValue({ id: 'conn-1' });
vi.mock('../../src/modules/connections', () => ({
  createPersonalConnection: (...args: any[]) => mockCreatePersonalConnection(...args),
}));

const mockGetOAuthAppCredentials = vi.fn();
const mockListConfiguredProviders = vi.fn();

vi.mock('../../src/modules/workspace-oauth-apps', () => {
  class OAuthAppNotConfiguredError extends Error {
    constructor(public workspaceId: string, public provider: string) {
      super(`Workspace ${workspaceId} has not configured a ${provider} OAuth app.`);
      this.name = 'OAuthAppNotConfiguredError';
    }
  }
  return {
    getOAuthAppCredentials: (...args: any[]) => mockGetOAuthAppCredentials(...args),
    listConfiguredProviders: (...args: any[]) => mockListConfiguredProviders(...args),
    OAuthAppNotConfiguredError,
  };
});

import {
  getOAuthUrl,
  handleOAuthCallback,
  getSupportedOAuthIntegrations,
  getProviderForIntegration,
  isGoogleIntegration,
} from '../../src/modules/connections/oauth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getProviderForIntegration', () => {
  it('maps google variants to google provider', () => {
    for (const id of ['google', 'google_drive', 'google-drive', 'google-sheets', 'google-docs', 'gmail']) {
      expect(getProviderForIntegration(id)).toBe('google');
    }
  });
  it('maps notion/github to their own providers', () => {
    expect(getProviderForIntegration('notion')).toBe('notion');
    expect(getProviderForIntegration('github')).toBe('github');
  });
  it('returns null for unknown integrations', () => {
    expect(getProviderForIntegration('unknown')).toBeNull();
  });
});

describe('isGoogleIntegration', () => {
  it('returns true for google-family ids', () => {
    expect(isGoogleIntegration('gmail')).toBe(true);
    expect(isGoogleIntegration('google-drive')).toBe(true);
  });
  it('returns false for non-google ids', () => {
    expect(isGoogleIntegration('github')).toBe(false);
    expect(isGoogleIntegration('notion')).toBe(false);
  });
});

describe('getSupportedOAuthIntegrations', () => {
  it('returns integrations whose provider has credentials configured for this workspace', async () => {
    mockListConfiguredProviders.mockResolvedValueOnce(['google']);
    const supported = await getSupportedOAuthIntegrations('W1');
    expect(supported).toContain('google');
    expect(supported).toContain('google_drive');
    expect(supported).toContain('gmail');
    expect(supported).not.toContain('notion');
    expect(supported).not.toContain('github');
  });

  it('returns empty array when no providers configured', async () => {
    mockListConfiguredProviders.mockResolvedValueOnce([]);
    expect(await getSupportedOAuthIntegrations('W_EMPTY')).toEqual([]);
  });
});

describe('getOAuthUrl', () => {
  it('generates an OAuth URL using the workspace-owned client id', async () => {
    mockGetOAuthAppCredentials.mockResolvedValueOnce({ clientId: 'ws-client-id', clientSecret: 'sec' });
    mockExecute.mockResolvedValueOnce(undefined);

    const { url, state } = await getOAuthUrl('google_drive', 'W1', 'U001', 'C123');

    expect(state).toBe('oauth-state-uuid');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=ws-client-id');
    expect(url).toContain('state=oauth-state-uuid');
    expect(mockGetOAuthAppCredentials).toHaveBeenCalledWith('W1', 'google');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oauth_states'),
      ['oauth-state-uuid', 'W1', 'U001', 'google_drive', 'C123'],
    );
  });

  it('throws OAuthAppNotConfiguredError when no credentials', async () => {
    mockGetOAuthAppCredentials.mockResolvedValueOnce(null);
    await expect(getOAuthUrl('google_drive', 'W1', 'U001')).rejects.toMatchObject({
      name: 'OAuthAppNotConfiguredError',
      provider: 'google',
      workspaceId: 'W1',
    });
  });

  it('throws for unsupported integration without hitting credentials lookup', async () => {
    await expect(getOAuthUrl('unsupported', 'W1', 'U001')).rejects.toThrow('Unsupported OAuth integration');
    expect(mockGetOAuthAppCredentials).not.toHaveBeenCalled();
  });

  it('builds a Google URL with all 4 scopes and offline access', async () => {
    mockGetOAuthAppCredentials.mockResolvedValueOnce({ clientId: 'ws-client-id', clientSecret: 'sec' });
    mockExecute.mockResolvedValueOnce(undefined);

    const { url } = await getOAuthUrl('google', 'W1', 'U001', 'C456');

    expect(url).toContain('drive');
    expect(url).toContain('spreadsheets');
    expect(url).toContain('documents');
    expect(url).toContain('mail.google.com');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('callback%2Fgoogle');
  });

  it('builds a GitHub URL using the workspace github credentials', async () => {
    mockGetOAuthAppCredentials.mockResolvedValueOnce({ clientId: 'ws-github-id', clientSecret: 'sec' });
    mockExecute.mockResolvedValueOnce(undefined);

    const { url } = await getOAuthUrl('github', 'W1', 'U001');

    expect(url).toContain('github.com/login/oauth/authorize');
    expect(url).toContain('client_id=ws-github-id');
    expect(mockGetOAuthAppCredentials).toHaveBeenCalledWith('W1', 'github');
  });

  it('isolates workspaces — two workspaces get different client ids in their URLs', async () => {
    mockGetOAuthAppCredentials.mockResolvedValueOnce({ clientId: 'W1-client-id', clientSecret: 'sec1' });
    mockExecute.mockResolvedValueOnce(undefined);
    const { url: url1 } = await getOAuthUrl('gmail', 'W1', 'U1');

    mockGetOAuthAppCredentials.mockResolvedValueOnce({ clientId: 'W2-client-id', clientSecret: 'sec2' });
    mockExecute.mockResolvedValueOnce(undefined);
    const { url: url2 } = await getOAuthUrl('gmail', 'W2', 'U2');

    expect(url1).toContain('client_id=W1-client-id');
    expect(url1).not.toContain('W2-client-id');
    expect(url2).toContain('client_id=W2-client-id');
    expect(url2).not.toContain('W1-client-id');
  });
});

describe('handleOAuthCallback', () => {
  it('rejects invalid or expired state', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    await expect(handleOAuthCallback('google_drive', 'code123', 'bad-state'))
      .rejects.toThrow('Invalid or expired OAuth state');
  });

  it('throws for unsupported integration even with valid state', async () => {
    mockQueryOne.mockResolvedValueOnce({
      state: 'valid-state',
      workspace_id: 'W1',
      user_id: 'U001',
      integration_id: 'unsupported',
      redirect_channel_id: null,
    });
    mockExecute.mockResolvedValueOnce(undefined);

    await expect(handleOAuthCallback('unsupported', 'code123', 'valid-state'))
      .rejects.toThrow('Unsupported OAuth integration');
  });

  it('throws OAuthAppNotConfiguredError if workspace lost creds mid-flow', async () => {
    mockQueryOne.mockResolvedValueOnce({
      state: 'valid-state',
      workspace_id: 'W1',
      user_id: 'U001',
      integration_id: 'google_drive',
      redirect_channel_id: null,
    });
    mockExecute.mockResolvedValueOnce(undefined);
    mockGetOAuthAppCredentials.mockResolvedValueOnce(null);

    await expect(handleOAuthCallback('google_drive', 'code123', 'valid-state'))
      .rejects.toMatchObject({ name: 'OAuthAppNotConfiguredError', provider: 'google' });
  });
});
