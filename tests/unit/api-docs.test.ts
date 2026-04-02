import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockCreateDocument = vi.fn();
const mockGetDocument = vi.fn();
const mockListDocuments = vi.fn();
const mockUpdateDocument = vi.fn();
const mockArchiveDocument = vi.fn();
const mockDeleteDocument = vi.fn();
const mockSearchDocuments = vi.fn();
const mockGetDocumentStats = vi.fn();
const mockListVersions = vi.fn();
const mockGetVersion = vi.fn();
const mockRestoreVersion = vi.fn();
const mockCreateSheetTab = vi.fn();
const mockGetSheetTabs = vi.fn();
const mockUpdateSheetTab = vi.fn();
const mockDeleteSheetTab = vi.fn();
const mockReorderSheetTabs = vi.fn();
const mockUpdateCells = vi.fn();
const mockAppendRows = vi.fn();
const mockUploadFile = vi.fn();
const mockGetFileDownload = vi.fn();
const mockUpdateFileContent = vi.fn();

vi.mock('../../src/modules/docs', () => ({
  createDocument: (...args: any[]) => mockCreateDocument(...args),
  getDocument: (...args: any[]) => mockGetDocument(...args),
  listDocuments: (...args: any[]) => mockListDocuments(...args),
  updateDocument: (...args: any[]) => mockUpdateDocument(...args),
  archiveDocument: (...args: any[]) => mockArchiveDocument(...args),
  deleteDocument: (...args: any[]) => mockDeleteDocument(...args),
  searchDocuments: (...args: any[]) => mockSearchDocuments(...args),
  getDocumentStats: (...args: any[]) => mockGetDocumentStats(...args),
  listVersions: (...args: any[]) => mockListVersions(...args),
  getVersion: (...args: any[]) => mockGetVersion(...args),
  restoreVersion: (...args: any[]) => mockRestoreVersion(...args),
  createSheetTab: (...args: any[]) => mockCreateSheetTab(...args),
  getSheetTabs: (...args: any[]) => mockGetSheetTabs(...args),
  updateSheetTab: (...args: any[]) => mockUpdateSheetTab(...args),
  deleteSheetTab: (...args: any[]) => mockDeleteSheetTab(...args),
  reorderSheetTabs: (...args: any[]) => mockReorderSheetTabs(...args),
  updateCells: (...args: any[]) => mockUpdateCells(...args),
  appendRows: (...args: any[]) => mockAppendRows(...args),
  uploadFile: (...args: any[]) => mockUploadFile(...args),
  getFileDownload: (...args: any[]) => mockGetFileDownload(...args),
  updateFileContent: (...args: any[]) => mockUpdateFileContent(...args),
  MAX_FILE_SIZE: 50 * 1024 * 1024,
}));

const mockIsPlatformAdmin = vi.fn();
const mockCanView = vi.fn();
const mockCanModifyAgent = vi.fn();

vi.mock('../../src/modules/access-control', () => ({
  isPlatformAdmin: (...args: any[]) => mockIsPlatformAdmin(...args),
  canView: (...args: any[]) => mockCanView(...args),
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/modules/docs/convert', () => ({
  slateJsonToMarkdown: vi.fn().mockReturnValue('# Test'),
  cellDataToCsv: vi.fn().mockReturnValue('a,b\n1,2'),
  csvToCellData: vi.fn().mockReturnValue({}),
  markdownToSlateJson: vi.fn().mockReturnValue([{ type: 'paragraph', children: [{ text: 'test' }] }]),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import docRoutes from '../../src/api/routes/docs';

// ── Test Helpers ──

const WS = 'W123';
const USER = 'U123';
const OTHER_USER = 'U999';

function makeDoc(overrides: Record<string, any> = {}) {
  return {
    id: 'doc-1',
    workspace_id: WS,
    type: 'doc',
    title: 'Test Doc',
    description: null,
    content: null,
    mime_type: null,
    file_size: null,
    tags: [],
    agent_id: null,
    run_id: null,
    created_by: USER,
    created_by_type: 'user',
    updated_by: null,
    agent_editable: false,
    version: 1,
    is_archived: false,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

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

function createApp(userId: string = USER, platformRole: string = 'member') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = {
      user: {
        userId,
        workspaceId: WS,
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        platformRole,
      },
    };
    req.sessionUser = req.session.user;
    next();
  });
  app.use('/docs', docRoutes);
  return app;
}

// ── Tests ──

describe('Document Routes Access Control', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: non-admin user
    mockIsPlatformAdmin.mockResolvedValue(false);
    mockCanView.mockResolvedValue(true);
    mockCanModifyAgent.mockResolvedValue(false);
    app = createApp();
  });

  // ────────────────────────────────────────────────
  // checkDocPermission — via GET /:id
  // ────────────────────────────────────────────────
  describe('View permission (GET /docs/:id)', () => {
    it('allows platform admin to view any document', async () => {
      mockIsPlatformAdmin.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1');

      expect(res.status).toBe(200);
    });

    it('allows agent viewer to view agent-scoped document', async () => {
      mockCanView.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1');

      expect(res.status).toBe(200);
      expect(mockCanView).toHaveBeenCalledWith(WS, 'agent-1', USER);
    });

    it('blocks user without agent view access', async () => {
      mockCanView.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("don't have permission");
    });

    it('allows any user to view non-agent doc', async () => {
      const doc = makeDoc({ agent_id: null, created_by: OTHER_USER });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1');

      expect(res.status).toBe(200);
    });

    it('returns 404 when document not found', async () => {
      mockGetDocument.mockResolvedValue(null);

      const res = await makeRequest(app, 'GET', '/docs/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────
  // Modify permission (PATCH /docs/:id)
  // ────────────────────────────────────────────────
  describe('Modify permission (PATCH /docs/:id)', () => {
    it('allows platform admin to update any document', async () => {
      mockIsPlatformAdmin.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);
      mockUpdateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'PATCH', '/docs/doc-1', {
        title: 'Updated', expectedVersion: 1,
      });

      expect(res.status).toBe(200);
    });

    it('allows agent owner to update agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);
      mockUpdateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'PATCH', '/docs/doc-1', {
        title: 'Updated', expectedVersion: 1,
      });

      expect(res.status).toBe(200);
      expect(mockCanModifyAgent).toHaveBeenCalledWith(WS, 'agent-1', USER);
    });

    it('blocks agent member from updating agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'PATCH', '/docs/doc-1', {
        title: 'Updated', expectedVersion: 1,
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("don't have permission");
    });

    it('allows creator to update non-agent document', async () => {
      const doc = makeDoc({ agent_id: null, created_by: USER });
      mockGetDocument.mockResolvedValue(doc);
      mockUpdateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'PATCH', '/docs/doc-1', {
        title: 'Updated', expectedVersion: 1,
      });

      expect(res.status).toBe(200);
    });

    it('blocks non-creator from updating non-agent document', async () => {
      const doc = makeDoc({ agent_id: null, created_by: OTHER_USER });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'PATCH', '/docs/doc-1', {
        title: 'Updated', expectedVersion: 1,
      });

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // Archive permission (DELETE /docs/:id)
  // ────────────────────────────────────────────────
  describe('Archive permission (DELETE /docs/:id)', () => {
    it('allows agent owner to archive agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);
      mockArchiveDocument.mockResolvedValue(undefined);

      const res = await makeRequest(app, 'DELETE', '/docs/doc-1');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('blocks agent member from archiving agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'DELETE', '/docs/doc-1');

      expect(res.status).toBe(403);
    });

    it('returns 404 when document not found for archive', async () => {
      mockGetDocument.mockResolvedValue(null);

      const res = await makeRequest(app, 'DELETE', '/docs/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────
  // Create permission (POST /docs)
  // ────────────────────────────────────────────────
  describe('Create permission (POST /docs)', () => {
    it('allows any user to create non-agent document', async () => {
      const doc = makeDoc();
      mockCreateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs', {
        type: 'doc', title: 'New Doc',
      });

      expect(res.status).toBe(201);
    });

    it('allows agent owner to create agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockCreateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs', {
        type: 'doc', title: 'New Doc', agentId: 'agent-1',
      });

      expect(res.status).toBe(201);
      expect(mockCanModifyAgent).toHaveBeenCalledWith(WS, 'agent-1', USER);
    });

    it('blocks non-owner from creating agent-scoped document', async () => {
      mockCanModifyAgent.mockResolvedValue(false);

      const res = await makeRequest(app, 'POST', '/docs', {
        type: 'doc', title: 'New Doc', agentId: 'agent-1',
      });

      expect(res.status).toBe(403);
    });

    it('allows platform admin to create agent-scoped document', async () => {
      mockIsPlatformAdmin.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockCreateDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs', {
        type: 'doc', title: 'New Doc', agentId: 'agent-1',
      });

      expect(res.status).toBe(201);
      // canModifyAgent should not be called because isPlatformAdmin short-circuits
      expect(mockCanModifyAgent).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // Version history view (GET /docs/:id/versions)
  // ────────────────────────────────────────────────
  describe('Version history view permission (GET /docs/:id/versions)', () => {
    it('allows viewer to list versions', async () => {
      mockCanView.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);
      mockListVersions.mockResolvedValue([]);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/versions');

      expect(res.status).toBe(200);
    });

    it('blocks non-viewer from listing versions', async () => {
      mockCanView.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/versions');

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // Version restore (POST /docs/:id/versions/:version/restore)
  // ────────────────────────────────────────────────
  describe('Version restore permission', () => {
    it('allows agent owner to restore version', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);
      mockRestoreVersion.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs/doc-1/versions/1/restore');

      expect(res.status).toBe(200);
    });

    it('blocks agent member from restoring version', async () => {
      mockCanModifyAgent.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs/doc-1/versions/1/restore');

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // Sheet tab modify routes
  // ────────────────────────────────────────────────
  describe('Sheet tab modify permission', () => {
    it('allows agent owner to create tab', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);
      mockCreateSheetTab.mockResolvedValue({ id: 'tab-1', name: 'New Sheet' });

      const res = await makeRequest(app, 'POST', '/docs/doc-1/tabs', { name: 'New Sheet' });

      expect(res.status).toBe(201);
    });

    it('blocks agent member from creating tab', async () => {
      mockCanModifyAgent.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs/doc-1/tabs', { name: 'New Sheet' });

      expect(res.status).toBe(403);
    });

    it('allows agent owner to reorder tabs', async () => {
      mockCanModifyAgent.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);
      mockReorderSheetTabs.mockResolvedValue(undefined);

      const res = await makeRequest(app, 'POST', '/docs/doc-1/tabs/reorder', { tabIds: ['t1', 't2'] });

      expect(res.status).toBe(200);
    });

    it('blocks agent member from reordering tabs', async () => {
      mockCanModifyAgent.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'POST', '/docs/doc-1/tabs/reorder', { tabIds: ['t1', 't2'] });

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // Sheet tab view route
  // ────────────────────────────────────────────────
  describe('Sheet tab view permission (GET /docs/:id/tabs)', () => {
    it('allows viewer to list tabs', async () => {
      mockCanView.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);
      mockGetSheetTabs.mockResolvedValue([]);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/tabs');

      expect(res.status).toBe(200);
    });

    it('blocks non-viewer from listing tabs', async () => {
      mockCanView.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'sheet' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/tabs');

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // Export permission (GET /docs/:id/export)
  // ────────────────────────────────────────────────
  describe('Export permission (GET /docs/:id/export)', () => {
    it('allows viewer to export document', async () => {
      mockCanView.mockResolvedValue(true);
      const doc = makeDoc({ agent_id: 'agent-1', type: 'doc', content: {} });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/export?format=markdown');

      expect(res.status).toBe(200);
    });

    it('blocks non-viewer from exporting document', async () => {
      mockCanView.mockResolvedValue(false);
      const doc = makeDoc({ agent_id: 'agent-1' });
      mockGetDocument.mockResolvedValue(doc);

      const res = await makeRequest(app, 'GET', '/docs/doc-1/export?format=markdown');

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────
  // List and search routes (no permission changes)
  // ────────────────────────────────────────────────
  describe('List and search (workspace-scoped, no per-doc check)', () => {
    it('lists documents without per-doc permission check', async () => {
      mockListDocuments.mockResolvedValue({ docs: [], total: 0 });

      const res = await makeRequest(app, 'GET', '/docs');

      expect(res.status).toBe(200);
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled();
    });

    it('searches documents without per-doc permission check', async () => {
      mockSearchDocuments.mockResolvedValue([]);

      const res = await makeRequest(app, 'GET', '/docs/search?q=test');

      expect(res.status).toBe(200);
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled();
    });

    it('gets stats without per-doc permission check', async () => {
      mockGetDocumentStats.mockResolvedValue({ totalDocs: 0, totalSheets: 0, totalFiles: 0, totalArchived: 0 });

      const res = await makeRequest(app, 'GET', '/docs/stats');

      expect(res.status).toBe(200);
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // Permanent delete (admin-only, existing behavior)
  // ────────────────────────────────────────────────
  describe('Permanent delete (DELETE /docs/:id/permanent)', () => {
    it('blocks non-admin from permanent delete', async () => {
      const res = await makeRequest(app, 'DELETE', '/docs/doc-1/permanent');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Admin access required');
    });

    it('allows admin to permanently delete', async () => {
      app = createApp(USER, 'admin');
      mockDeleteDocument.mockResolvedValue(undefined);

      const res = await makeRequest(app, 'DELETE', '/docs/doc-1/permanent');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
