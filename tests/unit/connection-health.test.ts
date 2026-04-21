import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: vi.fn(),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockEncrypt = vi.fn().mockReturnValue({ encrypted: 'enc_data', iv: 'iv123' });
const mockDecrypt = vi.fn();

vi.mock('../../src/modules/connections/crypto', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    server: { webDashboardUrl: 'https://dashboard.example.com' },
  },
}));

const mockRefreshGoogleAccessToken = vi.fn();
const mockIsGoogleIntegration = vi.fn();

vi.mock('../../src/modules/connections/oauth', () => ({
  refreshGoogleAccessToken: (...args: any[]) => mockRefreshGoogleAccessToken(...args),
  isGoogleIntegration: (...args: any[]) => mockIsGoogleIntegration(...args),
}));

const mockSendDMBlocks = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/slack', () => ({
  sendDMBlocks: (...args: any[]) => mockSendDMBlocks(...args),
}));

vi.mock('../../src/modules/tools/integrations', () => ({
  getIntegration: (id: string) => ({ label: id === 'gmail' ? 'Gmail' : id }),
}));

import { checkConnectionHealth } from '../../src/modules/connections/health';

const TEST_WORKSPACE_ID = 'W_TEST_123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkConnectionHealth', () => {
  it('should do nothing when no connections exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      [TEST_WORKSPACE_ID]
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should refresh Google OAuth tokens and update credentials', async () => {
    const conn = {
      id: 'conn-1',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'gmail',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U001',
      user_id: 'U001',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"old","refresh_token":"refresh_tok"}');
    mockIsGoogleIntegration.mockReturnValue(true);
    mockRefreshGoogleAccessToken.mockResolvedValue('fresh_token');

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockRefreshGoogleAccessToken).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 'refresh_tok');
    expect(mockEncrypt).toHaveBeenCalledWith(
      expect.stringContaining('"access_token":"fresh_token"')
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('oauth_token_expires_at'),
      expect.arrayContaining([conn.id])
    );
    // Should NOT send DM (refresh succeeded)
    expect(mockSendDMBlocks).not.toHaveBeenCalled();
  });

  it('should mark expired and send DM when Google refresh fails', async () => {
    const conn = {
      id: 'conn-2',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'gmail',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U002',
      user_id: 'U002',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"old","refresh_token":"bad_refresh"}');
    mockIsGoogleIntegration.mockReturnValue(true);
    mockRefreshGoogleAccessToken.mockRejectedValue(new Error('Token revoked'));

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    // Should mark expired
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'expired'"),
      [conn.id]
    );
    // Should send DM with dashboard CTA
    expect(mockSendDMBlocks).toHaveBeenCalledWith(
      'U002',
      expect.arrayContaining([
        expect.objectContaining({ type: 'section' }),
        expect.objectContaining({
          type: 'actions',
          elements: expect.arrayContaining([
            expect.objectContaining({
              url: 'https://dashboard.example.com/connections',
            }),
          ]),
        }),
      ]),
      expect.stringContaining('expired')
    );
  });

  it('should mark expired when non-Google token is past expiry', async () => {
    const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
    const conn = {
      id: 'conn-3',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'notion',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U003',
      user_id: 'U003',
      oauth_token_expires_at: pastDate,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"some_token"}');
    mockIsGoogleIntegration.mockReturnValue(false);

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'expired'"),
      [conn.id]
    );
    expect(mockSendDMBlocks).toHaveBeenCalledWith(
      'U003',
      expect.any(Array),
      expect.stringContaining('expired')
    );
  });

  it('should NOT expire non-Google connections with future expiry', async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
    const conn = {
      id: 'conn-4',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'github',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U004',
      user_id: 'U004',
      oauth_token_expires_at: futureDate,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"valid_token"}');
    mockIsGoogleIntegration.mockReturnValue(false);

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendDMBlocks).not.toHaveBeenCalled();
  });

  it('should skip non-OAuth connections (no refresh_token, no expiry)', async () => {
    const conn = {
      id: 'conn-5',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'chargebee',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U005',
      user_id: 'U005',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"api_key":"key-123"}');
    mockIsGoogleIntegration.mockReturnValue(false);

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockRefreshGoogleAccessToken).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSendDMBlocks).not.toHaveBeenCalled();
  });

  it('should handle decrypt errors gracefully per-connection', async () => {
    const conn1 = {
      id: 'conn-bad',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'gmail',
      credentials_encrypted: 'corrupt',
      credentials_iv: 'bad',
      created_by: 'U006',
      user_id: 'U006',
      oauth_token_expires_at: null,
    };
    const conn2 = {
      id: 'conn-good',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'chargebee',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U007',
      user_id: 'U007',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn1, conn2]);
    // First decrypt throws, second succeeds
    mockDecrypt
      .mockImplementationOnce(() => { throw new Error('Decrypt failed'); })
      .mockReturnValueOnce('{"api_key":"key"}');
    mockIsGoogleIntegration.mockReturnValue(false);

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    // Should still process conn2 (no crash)
    expect(mockDecrypt).toHaveBeenCalledTimes(2);
  });

  it('should notify created_by user, falling back to user_id', async () => {
    const conn = {
      id: 'conn-6',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'gmail',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: null,
      user_id: 'U_FALLBACK',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"old","refresh_token":"ref"}');
    mockIsGoogleIntegration.mockReturnValue(true);
    mockRefreshGoogleAccessToken.mockRejectedValue(new Error('revoked'));

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    expect(mockSendDMBlocks).toHaveBeenCalledWith(
      'U_FALLBACK',
      expect.any(Array),
      expect.any(String)
    );
  });

  it('should include dashboard reconnect button in DM when URL configured', async () => {
    const conn = {
      id: 'conn-7',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'gmail',
      credentials_encrypted: 'enc',
      credentials_iv: 'iv',
      created_by: 'U008',
      user_id: 'U008',
      oauth_token_expires_at: null,
    };
    mockQuery.mockResolvedValueOnce([conn]);
    mockDecrypt.mockReturnValue('{"access_token":"old","refresh_token":"ref"}');
    mockIsGoogleIntegration.mockReturnValue(true);
    mockRefreshGoogleAccessToken.mockRejectedValue(new Error('revoked'));

    await checkConnectionHealth(TEST_WORKSPACE_ID);

    const blocks = mockSendDMBlocks.mock.calls[0][1];
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('section');
    expect(blocks[0].text.text).toContain('gmail');
    expect(blocks[0].text.text).toContain('expired');
    expect(blocks[1].type).toBe('actions');
    expect(blocks[1].elements[0].text.text).toBe('Reconnect in Dashboard');
    expect(blocks[1].elements[0].url).toBe('https://dashboard.example.com/connections');
    expect(blocks[1].elements[0].style).toBe('primary');
  });
});
