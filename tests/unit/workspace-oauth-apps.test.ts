import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  query: (...args: any[]) => mockQuery(...args),
}));

const mockEncrypt = vi.fn().mockReturnValue({ encrypted: 'enc.tag', iv: 'iv-hex' });
const mockDecrypt = vi.fn();

vi.mock('../../src/modules/connections/crypto', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config', () => ({
  config: {
    oauth: { redirectBaseUrl: 'http://localhost:3000' },
  },
}));

import {
  getOAuthAppCredentials,
  getOAuthAppSummary,
  hasOAuthAppConfigured,
  setOAuthAppCredentials,
  clearOAuthAppCredentials,
  testOAuthAppCredentials,
  listConfiguredProviders,
  isValidGoogleClientId,
  isValidGoogleClientSecret,
  OAuthAppNotConfiguredError,
  SUPPORTED_PROVIDERS,
} from '../../src/modules/workspace-oauth-apps';

beforeEach(() => {
  vi.clearAllMocks();
  mockEncrypt.mockReturnValue({ encrypted: 'enc.tag', iv: 'iv-hex' });
});

describe('format validators', () => {
  it('accepts a well-formed Google client id', () => {
    expect(isValidGoogleClientId('123456-abc123def.apps.googleusercontent.com')).toBe(true);
  });
  it('rejects malformed client ids', () => {
    expect(isValidGoogleClientId('not-a-client-id')).toBe(false);
    expect(isValidGoogleClientId('abc.apps.googleusercontent.com')).toBe(false);
  });
  it('accepts a Google client secret with GOCSPX- prefix', () => {
    expect(isValidGoogleClientSecret('GOCSPX-abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });
  it('rejects secrets without the prefix', () => {
    expect(isValidGoogleClientSecret('some-random-secret')).toBe(false);
    expect(isValidGoogleClientSecret('GOCSPX-short')).toBe(false);
  });
});

describe('SUPPORTED_PROVIDERS', () => {
  it('includes google, notion, github', () => {
    expect(SUPPORTED_PROVIDERS).toEqual(['google', 'notion', 'github']);
  });
});

describe('OAuthAppNotConfiguredError', () => {
  it('carries workspaceId and provider', () => {
    const err = new OAuthAppNotConfiguredError('W1', 'google');
    expect(err.workspaceId).toBe('W1');
    expect(err.provider).toBe('google');
    expect(err.name).toBe('OAuthAppNotConfiguredError');
  });
});

describe('getOAuthAppCredentials', () => {
  it('returns null when nothing configured', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const result = await getOAuthAppCredentials('W1', 'google');
    expect(result).toBeNull();
  });

  it('decrypts and returns credentials when row exists', async () => {
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'W1', provider: 'google',
      client_id: 'cid.apps.googleusercontent.com',
      client_secret_encrypted: 'enc.tag', client_secret_iv: 'iv-hex',
    });
    mockDecrypt.mockReturnValueOnce('GOCSPX-secret');
    const result = await getOAuthAppCredentials('W1', 'google');
    expect(result).toEqual({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'GOCSPX-secret' });
  });

  it('returns null when decrypt throws (treat as misconfigured)', async () => {
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'W1', provider: 'google',
      client_id: 'cid', client_secret_encrypted: 'garbage', client_secret_iv: 'iv-hex',
    });
    mockDecrypt.mockImplementation(() => { throw new Error('bad cipher'); });
    expect(await getOAuthAppCredentials('W1', 'google')).toBeNull();
  });

  it('rejects unsupported providers synchronously', async () => {
    await expect(getOAuthAppCredentials('W1', 'slack' as any)).rejects.toThrow('Unsupported OAuth provider');
  });
});

describe('hasOAuthAppConfigured', () => {
  it('is true when provider row exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: true });
    expect(await hasOAuthAppConfigured('W1', 'google')).toBe(true);
  });
  it('is false when provider row is absent', async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: false });
    expect(await hasOAuthAppConfigured('W1', 'google')).toBe(false);
  });
});

describe('getOAuthAppSummary', () => {
  it('returns null when not configured', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await getOAuthAppSummary('W1', 'google')).toBeNull();
  });

  it('masks the client id and omits the secret', async () => {
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'W1',
      provider: 'google',
      client_id: '1234567890-abcdefgh.apps.googleusercontent.com',
      client_secret_encrypted: 'enc.tag',
      client_secret_iv: 'iv-hex',
      publishing_status: 'internal',
      configured_by_user_id: 'U1',
      configured_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z',
    });
    const summary = await getOAuthAppSummary('W1', 'google');
    expect(summary).not.toBeNull();
    expect(summary!.clientIdMasked).toContain('••••');
    expect(summary!.clientIdMasked).not.toEqual(summary!.clientId); // the summary exposes both for API shaping; route returns only masked
    expect(summary!.publishingStatus).toBe('internal');
  });
});

describe('setOAuthAppCredentials', () => {
  it('validates Google client id format', async () => {
    await expect(setOAuthAppCredentials('W1', 'google', {
      clientId: 'bogus',
      clientSecret: 'GOCSPX-abcdefghijklmnopqrstuvwxyz',
      userId: 'U1',
    })).rejects.toThrow(/client id/i);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('validates Google client secret format', async () => {
    await expect(setOAuthAppCredentials('W1', 'google', {
      clientId: '123-abc.apps.googleusercontent.com',
      clientSecret: 'not-a-google-secret',
      userId: 'U1',
    })).rejects.toThrow(/client secret/i);
  });

  it('requires non-empty clientId and clientSecret', async () => {
    await expect(setOAuthAppCredentials('W1', 'google', {
      clientId: '', clientSecret: 'GOCSPX-abcdefghijklmnopqrstuvwxyz', userId: null,
    })).rejects.toThrow(/clientId is required/);
    await expect(setOAuthAppCredentials('W1', 'google', {
      clientId: '123-abc.apps.googleusercontent.com', clientSecret: '', userId: null,
    })).rejects.toThrow(/clientSecret is required/);
  });

  it('encrypts the secret, upserts the row, and returns a summary', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    mockQueryOne.mockResolvedValueOnce({
      workspace_id: 'W1', provider: 'google',
      client_id: '123-abc.apps.googleusercontent.com',
      client_secret_encrypted: 'enc.tag', client_secret_iv: 'iv-hex',
      publishing_status: 'internal', configured_by_user_id: 'U1',
      configured_at: '2026-04-20T00:00:00Z', updated_at: '2026-04-20T00:00:00Z',
    });
    const summary = await setOAuthAppCredentials('W1', 'google', {
      clientId: '123-abc.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-abcdefghijklmnopqrstuvwxyz',
      publishingStatus: 'internal',
      userId: 'U1',
    });
    expect(mockEncrypt).toHaveBeenCalledWith('GOCSPX-abcdefghijklmnopqrstuvwxyz');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workspace_oauth_apps'),
      ['W1', 'google', '123-abc.apps.googleusercontent.com', 'enc.tag', 'iv-hex', 'internal', 'U1'],
    );
    expect(summary.provider).toBe('google');
  });
});

describe('clearOAuthAppCredentials', () => {
  it('deletes the row for the given workspace + provider', async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await clearOAuthAppCredentials('W1', 'google');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM workspace_oauth_apps'),
      ['W1', 'google'],
    );
  });
});

describe('listConfiguredProviders', () => {
  it('returns the set of providers that have rows for this workspace', async () => {
    mockQuery.mockResolvedValueOnce([{ provider: 'google' }, { provider: 'notion' }]);
    const providers = await listConfiguredProviders('W1');
    expect(providers).toEqual(['google', 'notion']);
  });
});

describe('testOAuthAppCredentials', () => {
  it('returns not_configured when no row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const result = await testOAuthAppCredentials('W1', 'google');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('not_configured');
  });

  it('returns unsupported_provider for non-google today', async () => {
    const result = await testOAuthAppCredentials('W1', 'notion');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('unsupported_provider');
  });
});
