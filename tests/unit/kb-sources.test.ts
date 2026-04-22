import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Mock setup ──
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockWithTransaction = vi.fn();
const mockGetProviderForConnector = vi.fn();
const mockSyncSource = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/modules/kb-sources/connectors', () => ({
  getProviderForConnector: (...args: any[]) => mockGetProviderForConnector(...args),
}));

vi.mock('../../src/modules/kb-sources/sync-handlers', () => ({
  syncSource: (...args: any[]) => mockSyncSource(...args),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import {
  getApiKey,
  setApiKey,
  setApiKeyField,
  removeApiKeyField,
  isProviderConfigured,
  listApiKeys,
  deleteApiKey,
  createSource,
  getSource,
  listSources,
  updateSource,
  deleteSource,
  toggleAutoSync,
  updateSourceStatus,
  startSync,
  flushAndResync,
  getSourcesDueForSync,
} from '../../src/modules/kb-sources/index';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════
// API Key Management
// ═══════════════════════════════════════════════════

describe('getApiKey', () => {
  it('should return the API key for a provider', async () => {
    const fakeKey = { id: 'k1', provider: 'google_drive', config_json: '{}', setup_complete: true };
    mockQueryOne.mockResolvedValue(fakeKey);

    const result = await getApiKey(TEST_WORKSPACE_ID, 'google_drive' as any);
    expect(result).toEqual(fakeKey);
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM kb_api_keys WHERE provider = $1 AND workspace_id = $2',
      ['google_drive', TEST_WORKSPACE_ID],
    );
  });

  it('should return null when no API key exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await getApiKey(TEST_WORKSPACE_ID, 'zendesk_help_center' as any);
    expect(result).toBeNull();
  });

  it('should return null when queryOne returns undefined', async () => {
    mockQueryOne.mockResolvedValue(undefined);
    const result = await getApiKey(TEST_WORKSPACE_ID, 'github' as any);
    expect(result).toBeNull();
  });
});

describe('setApiKey', () => {
  it('should create a new API key when none exists', async () => {
    mockQueryOne.mockResolvedValue(null); // getApiKey returns null

    const result = await setApiKey(TEST_WORKSPACE_ID, 'firecrawl' as any, { api_key: 'abc123' }, 'user1');

    expect(result.id).toBe('test-uuid-1234');
    expect(result.provider).toBe('firecrawl');
    expect(result.config_json).toBe(JSON.stringify({ api_key: 'abc123' }));
    expect(result.setup_complete).toBe(true);
    expect(result.created_by).toBe('user1');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO kb_api_keys'),
      expect.arrayContaining(['test-uuid-1234', TEST_WORKSPACE_ID, 'firecrawl']),
    );
  });

  it('should update an existing API key', async () => {
    const existing = {
      id: 'existing-id',
      provider: 'google_drive',
      config_json: '{"old":"val"}',
      setup_complete: false,
    };
    mockQueryOne.mockResolvedValue(existing);

    const result = await setApiKey(TEST_WORKSPACE_ID, 'google_drive' as any, { client_id: 'new' }, 'user2');

    expect(result.config_json).toBe(JSON.stringify({ client_id: 'new' }));
    expect(result.setup_complete).toBe(true);
    expect(result.id).toBe('existing-id'); // preserves existing id
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_api_keys SET'),
      expect.arrayContaining([JSON.stringify({ client_id: 'new' }), true, 'google_drive', TEST_WORKSPACE_ID]),
    );
  });

  it('should set setup_complete to false when any config value is empty', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await setApiKey(TEST_WORKSPACE_ID, 'github' as any, { api_key: 'xyz', secret: '' }, 'user1');

    expect(result.setup_complete).toBe(false);
  });

  it('should set setup_complete to false when a config value is only whitespace', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await setApiKey(TEST_WORKSPACE_ID, 'github' as any, { api_key: '  ' }, 'user1');

    expect(result.setup_complete).toBe(false);
  });
});

describe('setApiKeyField', () => {
  it('should add a field to an existing config', async () => {
    const existing = {
      id: 'k1',
      provider: 'google_drive',
      config_json: '{"client_id":"abc"}',
      setup_complete: true,
    };
    // First call for setApiKeyField's getApiKey, second for setApiKey's getApiKey
    mockQueryOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    const result = await setApiKeyField(TEST_WORKSPACE_ID, 'google_drive' as any, 'client_secret', 'xyz', 'user1');

    expect(result).toEqual({ client_id: 'abc', client_secret: 'xyz' });
  });

  it('should create config from scratch when no key exists', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await setApiKeyField(TEST_WORKSPACE_ID, 'reducto' as any, 'token', 'tok123', 'user1');

    expect(result).toEqual({ token: 'tok123' });
  });

  it('should overwrite an existing field value', async () => {
    const existing = {
      id: 'k1',
      provider: 'github',
      config_json: '{"token":"old"}',
      setup_complete: true,
    };
    mockQueryOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);

    const result = await setApiKeyField(TEST_WORKSPACE_ID, 'github' as any, 'token', 'new', 'user1');

    expect(result.token).toBe('new');
  });
});

describe('removeApiKeyField', () => {
  it('should remove a field from the config', async () => {
    const existing = {
      id: 'k1',
      provider: 'google_drive',
      config_json: '{"client_id":"abc","client_secret":"xyz"}',
      setup_complete: true,
    };
    mockQueryOne
      .mockResolvedValueOnce(existing) // removeApiKeyField's getApiKey
      .mockResolvedValueOnce(existing); // setApiKey's getApiKey

    const result = await removeApiKeyField(TEST_WORKSPACE_ID, 'google_drive' as any, 'client_secret', 'user1');

    expect(result).toEqual({ client_id: 'abc' });
    expect(result).not.toHaveProperty('client_secret');
  });

  it('should throw when no API key is configured for the provider', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(removeApiKeyField(TEST_WORKSPACE_ID, 'zendesk_help_center' as any, 'token', 'user1'))
      .rejects.toThrow('No API key configured for zendesk_help_center');
  });
});

describe('isProviderConfigured', () => {
  it('should return true when setup_complete is true', async () => {
    mockQueryOne.mockResolvedValue({ setup_complete: true });
    const result = await isProviderConfigured(TEST_WORKSPACE_ID, 'github' as any);
    expect(result).toBe(true);
  });

  it('should return false when setup_complete is false', async () => {
    mockQueryOne.mockResolvedValue({ setup_complete: false });
    const result = await isProviderConfigured(TEST_WORKSPACE_ID, 'github' as any);
    expect(result).toBe(false);
  });

  it('should return false when no API key exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await isProviderConfigured(TEST_WORKSPACE_ID, 'github' as any);
    expect(result).toBe(false);
  });
});

describe('listApiKeys', () => {
  it('should return all API keys ordered by provider', async () => {
    const keys = [
      { id: 'k1', provider: 'firecrawl' },
      { id: 'k2', provider: 'github' },
    ];
    mockQuery.mockResolvedValue(keys);

    const result = await listApiKeys(TEST_WORKSPACE_ID);
    expect(result).toEqual(keys);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM kb_api_keys WHERE workspace_id = $1 ORDER BY provider',
      [TEST_WORKSPACE_ID],
    );
  });

  it('should return empty array when no keys exist', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await listApiKeys(TEST_WORKSPACE_ID);
    expect(result).toEqual([]);
  });
});

describe('deleteApiKey', () => {
  it('should delete the API key for a provider', async () => {
    await deleteApiKey(TEST_WORKSPACE_ID, 'google_drive' as any, 'user1');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM kb_api_keys WHERE provider = $1 AND workspace_id = $2',
      ['google_drive', TEST_WORKSPACE_ID],
    );
  });
});

// ═══════════════════════════════════════════════════
// Source Management
// ═══════════════════════════════════════════════════

describe('createSource', () => {
  it('should create a source with active status when provider is configured', async () => {
    mockGetProviderForConnector.mockReturnValue('github');
    mockQueryOne.mockResolvedValue({ setup_complete: true }); // isProviderConfigured

    const result = await createSource(TEST_WORKSPACE_ID, {
      name: 'My Repo',
      sourceType: 'github' as any,
      config: { repo: 'owner/repo' },
      createdBy: 'user1',
    });

    expect(result.id).toBe('test-uuid-1234');
    expect(result.name).toBe('My Repo');
    expect(result.status).toBe('active');
    expect(result.auto_sync).toBe(false);
    expect(result.sync_interval_hours).toBe(24);
    expect(result.entry_count).toBe(0);
    expect(result.error_message).toBeNull();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO kb_sources'),
      expect.arrayContaining(['test-uuid-1234', 'My Repo']),
    );
  });

  it('should create a source with needs_setup status when provider is not configured', async () => {
    mockGetProviderForConnector.mockReturnValue('google_drive');
    mockQueryOne.mockResolvedValue(null); // no API key

    const result = await createSource(TEST_WORKSPACE_ID, {
      name: 'Docs',
      sourceType: 'google_drive' as any,
      config: { folder_id: 'abc' },
      createdBy: 'user1',
    });

    expect(result.status).toBe('needs_setup');
  });

  it('should serialize config as JSON', async () => {
    mockGetProviderForConnector.mockReturnValue('firecrawl');
    mockQueryOne.mockResolvedValue({ setup_complete: true });

    const result = await createSource(TEST_WORKSPACE_ID, {
      name: 'Site',
      sourceType: 'firecrawl' as any,
      config: { url: 'https://example.com', depth: '3' },
      createdBy: 'user1',
    });

    expect(result.config_json).toBe(JSON.stringify({ url: 'https://example.com', depth: '3' }));
  });
});

describe('getSource', () => {
  it('should return a source by id', async () => {
    const source = { id: 's1', name: 'Test', source_type: 'github' };
    mockQueryOne.mockResolvedValue(source);

    const result = await getSource(TEST_WORKSPACE_ID, 's1');
    expect(result).toEqual(source);
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM kb_sources WHERE id = $1 AND workspace_id = $2',
      ['s1', TEST_WORKSPACE_ID],
    );
  });

  it('should return null when source does not exist', async () => {
    mockQueryOne.mockResolvedValue(undefined);
    const result = await getSource(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('listSources', () => {
  it('should return all sources ordered by created_at DESC', async () => {
    const sources = [{ id: 's2' }, { id: 's1' }];
    mockQuery.mockResolvedValue(sources);

    const result = await listSources(TEST_WORKSPACE_ID);
    expect(result).toEqual(sources);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM kb_sources'),
      [TEST_WORKSPACE_ID],
    );
  });
});

describe('updateSource', () => {
  it('should update specified fields', async () => {
    await updateSource(TEST_WORKSPACE_ID, 's1', { name: 'Updated', status: 'error' as any });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_sources SET'),
      expect.arrayContaining(['Updated', 'error', 's1']),
    );
  });

  it('should do nothing when no fields are provided', async () => {
    await updateSource(TEST_WORKSPACE_ID, 's1', {});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should skip undefined values', async () => {
    await updateSource(TEST_WORKSPACE_ID, 's1', { name: undefined, entry_count: 5 } as any);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    // The query should only have entry_count, not name
    const callArgs = mockExecute.mock.calls[0];
    expect(callArgs[1]).toContain(5);
    expect(callArgs[1]).not.toContain(undefined);
  });
});

describe('deleteSource', () => {
  it('should delete chunks, entries, skip log, and source in order', async () => {
    await deleteSource(TEST_WORKSPACE_ID, 's1', 'user1');

    expect(mockExecute).toHaveBeenCalledTimes(4);
    // First: delete chunks
    expect(mockExecute.mock.calls[0][0]).toContain('DELETE FROM kb_chunks');
    expect(mockExecute.mock.calls[0][1]).toEqual(['s1', TEST_WORKSPACE_ID]);
    // Second: delete entries
    expect(mockExecute.mock.calls[1][0]).toContain('DELETE FROM kb_entries');
    expect(mockExecute.mock.calls[1][1]).toEqual(['s1', TEST_WORKSPACE_ID]);
    // Third: delete skip log (new in plan-020 — keeps log in sync with state)
    expect(mockExecute.mock.calls[2][0]).toContain('DELETE FROM kb_source_skip_log');
    expect(mockExecute.mock.calls[2][1]).toEqual(['s1', TEST_WORKSPACE_ID]);
    // Fourth: delete source
    expect(mockExecute.mock.calls[3][0]).toContain('DELETE FROM kb_sources');
    expect(mockExecute.mock.calls[3][1]).toEqual(['s1', TEST_WORKSPACE_ID]);
  });
});

describe('toggleAutoSync', () => {
  it('should enable auto-sync', async () => {
    await toggleAutoSync(TEST_WORKSPACE_ID, 's1', true);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_sources SET auto_sync'),
      expect.arrayContaining([true, 's1']),
    );
  });

  it('should disable auto-sync', async () => {
    await toggleAutoSync(TEST_WORKSPACE_ID, 's1', false);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_sources SET auto_sync'),
      expect.arrayContaining([false, 's1']),
    );
  });
});

describe('updateSourceStatus', () => {
  it('should update status with error message', async () => {
    await updateSourceStatus(TEST_WORKSPACE_ID, 's1', 'error' as any, 'Connection failed');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_sources SET status'),
      expect.arrayContaining(['error', 'Connection failed', 's1']),
    );
  });

  it('should set error_message to null when not provided', async () => {
    await updateSourceStatus(TEST_WORKSPACE_ID, 's1', 'active' as any);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['active', null, 's1']),
    );
  });
});

// ═══════════════════════════════════════════════════
// Sync Operations
// ═══════════════════════════════════════════════════

describe('startSync', () => {
  it('should start sync when source exists and provider is configured', async () => {
    const source = { id: 's1', source_type: 'github', name: 'Repo' };
    mockQueryOne
      .mockResolvedValueOnce(source) // getSource
      .mockResolvedValueOnce({ setup_complete: true }); // isProviderConfigured
    mockGetProviderForConnector.mockReturnValue('github');
    mockSyncSource.mockResolvedValue(undefined);

    await startSync(TEST_WORKSPACE_ID, 's1');

    expect(mockSyncSource).toHaveBeenCalledWith(TEST_WORKSPACE_ID, source);
  });

  it('should throw when source does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(startSync(TEST_WORKSPACE_ID, 'nonexistent')).rejects.toThrow('Source nonexistent not found');
  });

  it('should throw when provider is not configured', async () => {
    const source = { id: 's1', source_type: 'google_drive', name: 'Docs' };
    mockQueryOne
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null); // no API key
    mockGetProviderForConnector.mockReturnValue('google_drive');

    await expect(startSync(TEST_WORKSPACE_ID, 's1')).rejects.toThrow('Provider google_drive is not configured');
  });
});

describe('flushAndResync', () => {
  it('should flush entries and start a new sync', async () => {
    const source = { id: 's1', source_type: 'github', name: 'Repo' };
    // getSource in flushAndResync, getSource in startSync, isProviderConfigured
    mockQueryOne
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ setup_complete: true });
    mockGetProviderForConnector.mockReturnValue('github');
    mockSyncSource.mockResolvedValue(undefined);

    await flushAndResync(TEST_WORKSPACE_ID, 's1', 'user1');

    // Should delete chunks and entries
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM kb_chunks'),
      ['s1', TEST_WORKSPACE_ID],
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM kb_entries WHERE kb_source_id'),
      ['s1', TEST_WORKSPACE_ID],
    );
    // Should update entry_count to 0
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE kb_sources SET'),
      expect.arrayContaining([0]),
    );
    // Should call syncSource
    expect(mockSyncSource).toHaveBeenCalledWith(TEST_WORKSPACE_ID, source);
  });

  it('should throw when source does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(flushAndResync(TEST_WORKSPACE_ID, 'nonexistent', 'user1'))
      .rejects.toThrow('Source nonexistent not found');
  });
});

describe('getSourcesDueForSync', () => {
  it('should return sources due for auto-sync', async () => {
    const sources = [{ id: 's1' }, { id: 's2' }];
    mockQuery.mockResolvedValue(sources);

    const result = await getSourcesDueForSync();

    expect(result).toEqual(sources);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('auto_sync = TRUE'));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY last_sync_at ASC NULLS FIRST'));
  });

  it('should return empty array when no sources are due', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await getSourcesDueForSync();
    expect(result).toEqual([]);
  });
});
