import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock('../../src/db', () => ({
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  query: (...args: any[]) => mockQuery(...args),
}));

const mockGetSetting = vi.fn();
vi.mock('../../src/modules/workspace-settings', () => ({
  getSetting: (...args: any[]) => mockGetSetting(...args),
}));

const mockSetAnthropicApiKey = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/modules/anthropic', () => ({
  setAnthropicApiKey: (...args: any[]) => mockSetAnthropicApiKey(...args),
}));

const mockUpsertUser = vi.fn();
const mockSetMembership = vi.fn();
const mockAddPlatformAdmin = vi.fn();
vi.mock('../../src/modules/users', () => ({
  upsertUser: (...args: any[]) => mockUpsertUser(...args),
  setMembership: (...args: any[]) => mockSetMembership(...args),
  addPlatformAdmin: (...args: any[]) => mockAddPlatformAdmin(...args),
}));

const mockHasOAuthAppConfigured = vi.fn();
const mockSetOAuthAppCredentials = vi.fn().mockResolvedValue({});
vi.mock('../../src/modules/workspace-oauth-apps', () => ({
  hasOAuthAppConfigured: (...args: any[]) => mockHasOAuthAppConfigured(...args),
  setOAuthAppCredentials: (...args: any[]) => mockSetOAuthAppCredentials(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runMultiTenantBootstrap } from '../../src/modules/multitenant-migration';

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG_ENV };
  // default: nothing to backfill, anthropic already set, no GOOGLE_* env
  mockGetSetting.mockResolvedValue('already-set');
  // platform_roles table not present → backfill is a no-op
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('information_schema.tables')) return { exists: false };
    if (sql.includes('count(*)')) return { count: 1 };
    return undefined;
  });
  mockExecute.mockResolvedValue(undefined);
});

describe('multi-tenant bootstrap: Google OAuth app migration', () => {
  it('copies env credentials into workspace_oauth_apps on first boot (single-tenant install)', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'env-client-secret';
    mockHasOAuthAppConfigured.mockResolvedValueOnce(false);

    await runMultiTenantBootstrap('W1');

    expect(mockSetOAuthAppCredentials).toHaveBeenCalledWith('W1', 'google', {
      clientId: 'env-client-id',
      clientSecret: 'env-client-secret',
      publishingStatus: null,
      userId: null,
    });
  });

  it('is a no-op when the workspace already has a Google OAuth app configured', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'env-client-secret';
    mockHasOAuthAppConfigured.mockResolvedValueOnce(true);

    await runMultiTenantBootstrap('W1');

    expect(mockSetOAuthAppCredentials).not.toHaveBeenCalled();
  });

  it('is a no-op when env vars are unset', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    mockHasOAuthAppConfigured.mockResolvedValueOnce(false);

    await runMultiTenantBootstrap('W1');

    expect(mockSetOAuthAppCredentials).not.toHaveBeenCalled();
  });

  it('does not migrate when multiple workspaces exist (multi-tenant guard)', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'env-client-secret';
    mockHasOAuthAppConfigured.mockResolvedValueOnce(false);
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return { exists: false };
      if (sql.includes('count(*)')) return { count: 3 };
      return undefined;
    });

    await runMultiTenantBootstrap('W1');

    expect(mockSetOAuthAppCredentials).not.toHaveBeenCalled();
  });

  it('is idempotent — calling twice only migrates once', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'env-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'env-client-secret';
    // First call: not configured → migrate. Second call: configured → no-op.
    mockHasOAuthAppConfigured
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await runMultiTenantBootstrap('W1');
    await runMultiTenantBootstrap('W1');

    expect(mockSetOAuthAppCredentials).toHaveBeenCalledTimes(1);
  });
});
