import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    oauth: {
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-secret',
      notionClientId: '',
      notionClientSecret: '',
      githubClientId: 'gh-client-id',
      githubClientSecret: 'gh-secret',
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

// Mock audit module
vi.mock('../../src/modules/audit', () => ({
  logAuditEvent: vi.fn(),
}));

// Mock createPersonalConnection
const mockCreatePersonalConnection = vi.fn().mockResolvedValue({ id: 'conn-1' });
vi.mock('../../src/modules/connections', () => ({
  createPersonalConnection: (...args: any[]) => mockCreatePersonalConnection(...args),
}));

import { getOAuthUrl, handleOAuthCallback, getSupportedOAuthIntegrations } from '../../src/modules/connections/oauth';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getSupportedOAuthIntegrations', () => {
  it('should return only integrations with configured client credentials', () => {
    const supported = getSupportedOAuthIntegrations();

    expect(supported).toContain('google');
    expect(supported).toContain('google_drive');
    expect(supported).toContain('github');
    expect(supported).not.toContain('notion'); // no client id/secret configured
  });
});

describe('getOAuthUrl', () => {
  it('should generate an OAuth URL and store state in DB', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    const { url, state } = await getOAuthUrl('google_drive', 'W1', 'U001', 'C123');

    expect(state).toBe('oauth-state-uuid');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=google-client-id');
    expect(url).toContain('state=oauth-state-uuid');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oauth_states'),
      ['oauth-state-uuid', 'W1', 'U001', 'google_drive', 'C123']
    );
  });

  it('should throw for unsupported integration', async () => {
    await expect(getOAuthUrl('unsupported', 'W1', 'U001')).rejects.toThrow('Unsupported OAuth integration');
  });

  it('should throw when client ID is not configured', async () => {
    await expect(getOAuthUrl('notion', 'W1', 'U001')).rejects.toThrow('OAuth not configured');
  });

  it('should generate a Google OAuth URL with all scopes and offline access', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    const { url, state } = await getOAuthUrl('google', 'W1', 'U001', 'C456');

    expect(state).toBe('oauth-state-uuid');
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=google-client-id');
    // Should include all 4 scopes: drive, spreadsheets, documents, gmail
    expect(url).toContain('drive');
    expect(url).toContain('spreadsheets');
    expect(url).toContain('documents');
    expect(url).toContain('mail.google.com');
    // Should include access_type=offline and prompt=consent for refresh tokens
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    // Should use the google redirect callback path
    expect(url).toContain('callback%2Fgoogle');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oauth_states'),
      ['oauth-state-uuid', 'W1', 'U001', 'google', 'C456']
    );
  });

  it('should include access_type=offline and prompt=consent for google_drive', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    const { url } = await getOAuthUrl('google_drive', 'W1', 'U001', 'C123');

    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
  });

  it('should generate a GitHub OAuth URL', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    const { url } = await getOAuthUrl('github', 'W1', 'U001');

    expect(url).toContain('github.com/login/oauth/authorize');
    expect(url).toContain('client_id=gh-client-id');
  });
});

describe('handleOAuthCallback', () => {
  it('should reject invalid or expired state', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    await expect(handleOAuthCallback('google_drive', 'code123', 'bad-state'))
      .rejects.toThrow('Invalid or expired OAuth state');
  });

  it('should throw for unsupported integration even with valid state', async () => {
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
});
