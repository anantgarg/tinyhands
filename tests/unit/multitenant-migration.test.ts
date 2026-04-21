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

// Google OAuth env-migration was removed in v1.50.0 — each workspace admin
// configures their own Google Cloud OAuth client via Settings → Integrations.
// The one-off copy of env GOOGLE_OAUTH_CLIENT_ID into the legacy
// single-tenant workspace was done by hand during the v1.50.0 deploy.

describe('multi-tenant bootstrap: Anthropic key migration', () => {
  it('copies env ANTHROPIC_API_KEY into workspace_settings on first boot (single-tenant install)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockGetSetting.mockResolvedValueOnce(null); // key not yet set

    await runMultiTenantBootstrap('W1');

    expect(mockSetAnthropicApiKey).toHaveBeenCalledWith('W1', 'sk-ant-test', 'system-migration');
  });

  it('does not migrate when multiple workspaces exist (multi-tenant guard)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockGetSetting.mockResolvedValueOnce(null);
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) return { exists: false };
      if (sql.includes('count(*)')) return { count: 3 };
      return undefined;
    });

    await runMultiTenantBootstrap('W1');

    expect(mockSetAnthropicApiKey).not.toHaveBeenCalled();
  });

  it('is a no-op when workspace already has a key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockGetSetting.mockResolvedValueOnce('already-set');

    await runMultiTenantBootstrap('W1');

    expect(mockSetAnthropicApiKey).not.toHaveBeenCalled();
  });
});
