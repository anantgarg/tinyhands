import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockCreateKBEntry = vi.fn();
const mockApproveKBEntry = vi.fn();
const mockGetKBEntry = vi.fn();
const mockDeleteKBEntry = vi.fn();
const mockSearchKB = vi.fn();
const mockGetCategories = vi.fn();

vi.mock('../../src/modules/knowledge-base', () => ({
  createKBEntry: (...args: any[]) => mockCreateKBEntry(...args),
  approveKBEntry: (...args: any[]) => mockApproveKBEntry(...args),
  getKBEntry: (...args: any[]) => mockGetKBEntry(...args),
  deleteKBEntry: (...args: any[]) => mockDeleteKBEntry(...args),
  searchKB: (...args: any[]) => mockSearchKB(...args),
  getCategories: (...args: any[]) => mockGetCategories(...args),
}));

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

const mockListSources = vi.fn();
const mockCreateSource = vi.fn();
const mockUpdateSource = vi.fn();
const mockDeleteSource = vi.fn();
const mockStartSync = vi.fn();
const mockFlushAndResync = vi.fn();
const mockListApiKeys = vi.fn();
const mockSetApiKey = vi.fn();
const mockDeleteApiKey = vi.fn();

vi.mock('../../src/modules/kb-sources', () => ({
  listSources: (...args: any[]) => mockListSources(...args),
  createSource: (...args: any[]) => mockCreateSource(...args),
  updateSource: (...args: any[]) => mockUpdateSource(...args),
  deleteSource: (...args: any[]) => mockDeleteSource(...args),
  startSync: (...args: any[]) => mockStartSync(...args),
  flushAndResync: (...args: any[]) => mockFlushAndResync(...args),
  listApiKeys: (...args: any[]) => mockListApiKeys(...args),
  setApiKey: (...args: any[]) => mockSetApiKey(...args),
  deleteApiKey: (...args: any[]) => mockDeleteApiKey(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import kbRoutes from '../../src/api/routes/kb';

// ── HTTP Test Helper ──

function makeRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: Record<string, any>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }

      const payload = body ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let parsedBody: any;
          try { parsedBody = JSON.parse(data); } catch { parsedBody = data; }
          resolve({ status: res.statusCode || 0, body: parsedBody });
        });
      });

      req.on('error', (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function createApp(platformRole: string = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = {
      user: {
        userId: 'U123',
        workspaceId: 'W123',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        platformRole,
      },
    };
    req.sessionUser = req.session.user;
    next();
  });
  app.use('/kb', kbRoutes);
  return app;
}

// ── Tests ──

describe('KB Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    app = createApp();
  });

  // ── Entries ──

  describe('GET /kb/stats', () => {
    it('returns KB stats', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce([{ count: 2 }])
        .mockResolvedValueOnce([{ count: 3 }])
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ count: 4 }]);

      const res = await makeRequest(app, 'GET', '/kb/stats');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        totalEntries: 10,
        pendingEntries: 2,
        categories: 3,
        sourcesCount: 1,
        manualEntries: 4,
      });
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/kb/stats');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get stats' });
    });
  });

  describe('GET /kb/entries', () => {
    it('lists entries with pagination', async () => {
      const entries = [{ id: 'e1', title: 'Doc' }];
      mockQuery
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce(entries);

      const res = await makeRequest(app, 'GET', '/kb/entries');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ entries, total: 1 });
    });

    it('uses custom limit and page', async () => {
      mockQuery
        .mockResolvedValueOnce([{ count: 10 }])
        .mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/kb/entries?limit=5&page=2');

      // Count query + entries query
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/kb/entries');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list entries' });
    });
  });

  describe('GET /kb/entries/search', () => {
    it('searches KB', async () => {
      const results = [{ id: 'e1', title: 'Match' }];
      mockSearchKB.mockResolvedValueOnce(results);

      const res = await makeRequest(app, 'GET', '/kb/entries/search?q=test');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(results);
      expect(mockSearchKB).toHaveBeenCalledWith('W123', 'test', undefined, 10);
    });

    it('passes agentId filter', async () => {
      mockSearchKB.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/kb/entries/search?q=test&agentId=a1');

      expect(mockSearchKB).toHaveBeenCalledWith('W123', 'test', 'a1', 10);
    });

    it('returns 400 when q is missing', async () => {
      const res = await makeRequest(app, 'GET', '/kb/entries/search');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'q (query) is required' });
    });

    it('returns 500 on error', async () => {
      mockSearchKB.mockRejectedValueOnce(new Error('Search error'));

      const res = await makeRequest(app, 'GET', '/kb/entries/search?q=test');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Search failed' });
    });
  });

  describe('GET /kb/categories', () => {
    it('returns categories', async () => {
      mockGetCategories.mockResolvedValueOnce(['docs', 'faq']);

      const res = await makeRequest(app, 'GET', '/kb/categories');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(['docs', 'faq']);
    });

    it('returns 500 on error', async () => {
      mockGetCategories.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/kb/categories');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list categories' });
    });
  });

  describe('GET /kb/entries/:id', () => {
    it('returns entry by id', async () => {
      const entry = { id: 'e1', title: 'Doc' };
      mockGetKBEntry.mockResolvedValueOnce(entry);

      const res = await makeRequest(app, 'GET', '/kb/entries/e1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(entry);
    });

    it('returns 404 when not found', async () => {
      mockGetKBEntry.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/kb/entries/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Entry not found' });
    });

    it('returns 500 on error', async () => {
      mockGetKBEntry.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/kb/entries/e1');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get entry' });
    });
  });

  describe('POST /kb/entries', () => {
    it('creates entry', async () => {
      const entry = { id: 'e1', title: 'New' };
      mockCreateKBEntry.mockResolvedValueOnce(entry);

      const res = await makeRequest(app, 'POST', '/kb/entries', {
        title: 'New',
        content: 'Content here',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(entry);
      expect(mockCreateKBEntry).toHaveBeenCalledWith('W123', expect.objectContaining({
        title: 'New',
        contributedBy: 'U123',
        sourceType: 'manual',
      }));
    });

    it('uses provided sourceType', async () => {
      mockCreateKBEntry.mockResolvedValueOnce({ id: 'e1' });

      await makeRequest(app, 'POST', '/kb/entries', {
        title: 'New',
        sourceType: 'github',
      });

      expect(mockCreateKBEntry).toHaveBeenCalledWith('W123', expect.objectContaining({
        sourceType: 'github',
      }));
    });

    it('returns 400 on error', async () => {
      mockCreateKBEntry.mockRejectedValueOnce(new Error('Title required'));

      const res = await makeRequest(app, 'POST', '/kb/entries', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't create the knowledge base entry. Please try again." });
    });
  });

  describe('POST /kb/entries/:id/approve', () => {
    it('approves entry (admin)', async () => {
      const entry = { id: 'e1', status: 'approved' };
      mockApproveKBEntry.mockResolvedValueOnce(entry);

      const res = await makeRequest(app, 'POST', '/kb/entries/e1/approve');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(entry);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/kb/entries/e1/approve');

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockApproveKBEntry.mockRejectedValueOnce(new Error('Already approved'));

      const res = await makeRequest(app, 'POST', '/kb/entries/e1/approve');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't approve the entry. Please try again." });
    });
  });

  describe('DELETE /kb/entries/:id', () => {
    it('deletes entry (admin)', async () => {
      mockGetKBEntry.mockResolvedValueOnce({ id: 'e1', kb_source_id: null });
      mockDeleteKBEntry.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/kb/entries/e1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 404 when entry does not exist', async () => {
      mockGetKBEntry.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'DELETE', '/kb/entries/missing');

      expect(res.status).toBe(404);
    });

    it('returns 409 when entry is managed by a KB source', async () => {
      mockGetKBEntry.mockResolvedValueOnce({ id: 'e1', kb_source_id: 's1' });

      const res = await makeRequest(app, 'DELETE', '/kb/entries/e1');

      expect(res.status).toBe(409);
      expect(mockDeleteKBEntry).not.toHaveBeenCalled();
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'DELETE', '/kb/entries/e1');

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /kb/entries/:id', () => {
    it('returns 409 when entry is managed by a KB source', async () => {
      mockGetKBEntry.mockResolvedValueOnce({ id: 'e1', kb_source_id: 's1' });

      const res = await makeRequest(app, 'PATCH', '/kb/entries/e1', { title: 'x' });

      expect(res.status).toBe(409);
    });

    it('returns 404 when entry does not exist', async () => {
      mockGetKBEntry.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'PATCH', '/kb/entries/missing', { title: 'x' });

      expect(res.status).toBe(404);
    });
  });

  // ── Sources ──

  describe('GET /kb/sources', () => {
    it('lists sources', async () => {
      const sources = [{ id: 's1', name: 'GitHub' }];
      mockListSources.mockResolvedValueOnce(sources);

      const res = await makeRequest(app, 'GET', '/kb/sources');

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('s1');
      expect(res.body[0].name).toBe('GitHub');
    });

    it('returns 500 on error', async () => {
      mockListSources.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/kb/sources');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list sources' });
    });
  });

  describe('POST /kb/sources', () => {
    it('creates source (admin)', async () => {
      const source = { id: 's1', name: 'GitHub Docs' };
      mockCreateSource.mockResolvedValueOnce(source);

      const res = await makeRequest(app, 'POST', '/kb/sources', {
        name: 'GitHub Docs',
        sourceType: 'github',
        config: { repo: 'org/repo' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(source);
    });

    it('returns 400 when name or sourceType is missing', async () => {
      const res = await makeRequest(app, 'POST', '/kb/sources', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name and sourceType are required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/kb/sources', {
        name: 'Test',
        sourceType: 'github',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /kb/sources/:id', () => {
    it('updates source (admin)', async () => {
      mockUpdateSource.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PATCH', '/kb/sources/s1', {
        name: 'Updated',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'PATCH', '/kb/sources/s1', { name: 'X' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /kb/sources/:id', () => {
    it('deletes source (admin)', async () => {
      mockDeleteSource.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/kb/sources/s1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'DELETE', '/kb/sources/s1');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /kb/sources/:id/sync', () => {
    it('triggers sync (admin)', async () => {
      mockStartSync.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/kb/sources/s1/sync');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, message: 'Sync started' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/kb/sources/s1/sync');

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockStartSync.mockRejectedValueOnce(new Error('Sync already running'));

      const res = await makeRequest(app, 'POST', '/kb/sources/s1/sync');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't start the sync. Please try again." });
    });
  });

  describe('POST /kb/sources/:id/flush-and-resync', () => {
    it('flushes and resyncs (admin)', async () => {
      mockFlushAndResync.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/kb/sources/s1/flush-and-resync');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, message: 'Flush and resync started' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/kb/sources/s1/flush-and-resync');

      expect(res.status).toBe(403);
    });
  });

  // ── API Keys ──

  describe('GET /kb/api-keys', () => {
    it('lists API keys (admin)', async () => {
      const keys = [{ provider: 'github', label: 'GH' }];
      mockListApiKeys.mockResolvedValueOnce(keys);

      const res = await makeRequest(app, 'GET', '/kb/api-keys');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(keys);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/kb/api-keys');

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /kb/api-keys/:provider', () => {
    it('sets API key (admin)', async () => {
      const key = { provider: 'github' };
      mockSetApiKey.mockResolvedValueOnce(key);

      const res = await makeRequest(app, 'PUT', '/kb/api-keys/github', {
        config: { token: 'ghp_xxx' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(key);
    });

    it('returns 400 when config is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/kb/api-keys/github', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'config is required' });
    });
  });

  describe('DELETE /kb/api-keys/:provider', () => {
    it('deletes API key (admin)', async () => {
      mockDeleteApiKey.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/kb/api-keys/github');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'DELETE', '/kb/api-keys/github');

      expect(res.status).toBe(403);
    });
  });
});
