import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockGetBuiltinTools = vi.fn();
const mockListCustomTools = vi.fn();
const mockGetCustomTool = vi.fn();
const mockRegisterCustomTool = vi.fn();
const mockApproveCustomTool = vi.fn();
const mockDeleteCustomTool = vi.fn();
const mockGetToolConfig = vi.fn();
const mockUpdateToolConfig = vi.fn();
const mockSetToolConfigKey = vi.fn();
const mockRemoveToolConfigKey = vi.fn();
const mockUpdateToolAccessLevel = vi.fn();

vi.mock('../../src/modules/tools', () => ({
  getBuiltinTools: (...args: any[]) => mockGetBuiltinTools(...args),
  listCustomTools: (...args: any[]) => mockListCustomTools(...args),
  getCustomTool: (...args: any[]) => mockGetCustomTool(...args),
  registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
  approveCustomTool: (...args: any[]) => mockApproveCustomTool(...args),
  deleteCustomTool: (...args: any[]) => mockDeleteCustomTool(...args),
  getToolConfig: (...args: any[]) => mockGetToolConfig(...args),
  updateToolConfig: (...args: any[]) => mockUpdateToolConfig(...args),
  setToolConfigKey: (...args: any[]) => mockSetToolConfigKey(...args),
  removeToolConfigKey: (...args: any[]) => mockRemoveToolConfigKey(...args),
  updateToolAccessLevel: (...args: any[]) => mockUpdateToolAccessLevel(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetIntegrations = vi.fn();

vi.mock('../../src/modules/tools/integrations', () => ({
  getIntegrations: (...args: any[]) => mockGetIntegrations(...args),
}));

const mockCreateTeamConnection = vi.fn();
const mockListTeamConnectionsForTools = vi.fn();

vi.mock('../../src/modules/connections', () => ({
  createTeamConnection: (...args: any[]) => mockCreateTeamConnection(...args),
  listTeamConnections: (...args: any[]) => mockListTeamConnectionsForTools(...args),
}));

import toolRoutes from '../../src/api/routes/tools';

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
  app.use('/tools', toolRoutes);
  return app;
}

// ── Tests ──

describe('Tool Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('GET /tools/builtin', () => {
    it('returns builtin tools', async () => {
      const tools = [{ name: 'kb-search' }, { name: 'web-search' }];
      mockGetBuiltinTools.mockReturnValueOnce(tools);

      const res = await makeRequest(app, 'GET', '/tools/builtin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(tools);
    });

    it('returns 500 on error', async () => {
      mockGetBuiltinTools.mockImplementationOnce(() => { throw new Error('err'); });

      const res = await makeRequest(app, 'GET', '/tools/builtin');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list builtin tools' });
    });
  });

  describe('GET /tools/custom', () => {
    it('returns custom tools for admin', async () => {
      const tools = [{ name: 'my-tool' }];
      mockListCustomTools.mockResolvedValueOnce(tools);

      const res = await makeRequest(app, 'GET', '/tools/custom');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(tools);
      expect(mockListCustomTools).toHaveBeenCalledWith('W123');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/tools/custom');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Admin access required' });
    });

    it('returns 500 on error', async () => {
      mockListCustomTools.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/tools/custom');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list custom tools' });
    });
  });

  describe('GET /tools/custom/:name', () => {
    it('returns custom tool detail', async () => {
      const tool = { name: 'my-tool', code: 'console.log("hi")' };
      mockGetCustomTool.mockResolvedValueOnce(tool);

      const res = await makeRequest(app, 'GET', '/tools/custom/my-tool');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(tool);
    });

    it('returns 404 when not found', async () => {
      mockGetCustomTool.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/tools/custom/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Tool not found' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/tools/custom/my-tool');

      expect(res.status).toBe(403);
    });
  });

  describe('POST /tools/custom', () => {
    it('registers custom tool', async () => {
      const tool = { name: 'new-tool', id: 't1' };
      mockRegisterCustomTool.mockResolvedValueOnce(tool);

      const res = await makeRequest(app, 'POST', '/tools/custom', {
        name: 'new-tool',
        schemaJson: { type: 'object' },
        scriptCode: 'console.log("hi")',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(tool);
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        'W123', 'new-tool', '{"type":"object"}', null, 'U123', { code: 'console.log("hi")' },
      );
    });

    it('returns 400 when name or schemaJson is missing', async () => {
      const res = await makeRequest(app, 'POST', '/tools/custom', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name and schemaJson (or schema) are required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/tools/custom', {
        name: 'test',
        schemaJson: {},
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockRegisterCustomTool.mockRejectedValueOnce(new Error('Duplicate name'));

      const res = await makeRequest(app, 'POST', '/tools/custom', {
        name: 'dup',
        schemaJson: {},
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't register the tool. Please try again." });
    });
  });

  describe('POST /tools/custom/:name/approve', () => {
    it('approves custom tool', async () => {
      mockApproveCustomTool.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/tools/custom/my-tool/approve');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockApproveCustomTool).toHaveBeenCalledWith('W123', 'my-tool', 'U123');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/tools/custom/my-tool/approve');

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /tools/custom/:name', () => {
    it('deletes custom tool', async () => {
      mockDeleteCustomTool.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/tools/custom/my-tool');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockDeleteCustomTool).toHaveBeenCalledWith('W123', 'my-tool', 'U123');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'DELETE', '/tools/custom/my-tool');

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockDeleteCustomTool.mockRejectedValueOnce(new Error('Tool in use'));

      const res = await makeRequest(app, 'DELETE', '/tools/custom/my-tool');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't delete the tool. Please try again." });
    });
  });

  describe('GET /tools/custom/:name/config', () => {
    it('returns tool config', async () => {
      const config = { api_key: '***', site: 'test' };
      mockGetToolConfig.mockResolvedValueOnce(config);

      const res = await makeRequest(app, 'GET', '/tools/custom/my-tool/config');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(config);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/tools/custom/my-tool/config');

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /tools/custom/:name/config', () => {
    it('updates tool config', async () => {
      mockUpdateToolConfig.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PUT', '/tools/custom/my-tool/config', {
        configJson: { api_key: 'new-key' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 400 when configJson is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/tools/custom/my-tool/config', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'configJson is required' });
    });
  });

  describe('PATCH /tools/custom/:name/config', () => {
    it('sets a config key', async () => {
      const result = { api_key: 'val' };
      mockSetToolConfigKey.mockResolvedValueOnce(result);

      const res = await makeRequest(app, 'PATCH', '/tools/custom/my-tool/config', {
        key: 'api_key',
        value: 'val',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(result);
    });

    it('removes a config key when value is null', async () => {
      const result = {};
      mockRemoveToolConfigKey.mockResolvedValueOnce(result);

      const res = await makeRequest(app, 'PATCH', '/tools/custom/my-tool/config', {
        key: 'api_key',
        value: null,
      });

      expect(res.status).toBe(200);
      expect(mockRemoveToolConfigKey).toHaveBeenCalledWith('W123', 'my-tool', 'api_key', 'U123');
    });

    it('returns 400 when key is missing', async () => {
      const res = await makeRequest(app, 'PATCH', '/tools/custom/my-tool/config', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'key is required' });
    });
  });

  describe('PUT /tools/custom/:name/access-level', () => {
    it('updates tool access level', async () => {
      mockUpdateToolAccessLevel.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PUT', '/tools/custom/my-tool/access-level', {
        accessLevel: 'read_write',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 400 when accessLevel is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/tools/custom/my-tool/access-level', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'accessLevel is required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'PUT', '/tools/custom/my-tool/access-level', {
        accessLevel: 'read_only',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /tools/integrations', () => {
    it('returns integrations with status', async () => {
      mockGetIntegrations.mockReturnValueOnce([
        { id: 'linear', label: 'Linear', description: 'Issue tracker', tools: [{ name: 'linear-read' }], configKeys: ['api_key'], connectionModel: 'team' },
      ]);
      mockListTeamConnectionsForTools.mockResolvedValueOnce([
        { id: 'conn-1', integration_id: 'linear' },
      ]);

      const res = await makeRequest(app, 'GET', '/tools/integrations');

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('linear');
      expect(res.body[0].displayName).toBe('Linear');
      expect(res.body[0].status).toBe('active');
      expect(res.body[0].connectionId).toBe('conn-1');
      expect(res.body[0].toolsCount).toBe(1);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/tools/integrations');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockGetIntegrations.mockImplementationOnce(() => { throw new Error('err'); });

      const res = await makeRequest(app, 'GET', '/tools/integrations');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list integrations' });
    });
  });

  describe('POST /tools/integrations/register', () => {
    it('registers an integration', async () => {
      const conn = { id: 'c1' };
      mockCreateTeamConnection.mockResolvedValueOnce(conn);

      const res = await makeRequest(app, 'POST', '/tools/integrations/register', {
        integrationId: 'linear',
        config: { api_key: 'xxx' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(conn);
    });

    it('returns 400 when fields missing', async () => {
      const res = await makeRequest(app, 'POST', '/tools/integrations/register', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'integrationId and config are required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'POST', '/tools/integrations/register', {
        integrationId: 'linear',
        config: { api_key: 'xxx' },
      });

      expect(res.status).toBe(403);
    });
  });
});
