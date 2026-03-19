import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockListPlatformAdmins = vi.fn();
const mockSetPlatformRole = vi.fn();
const mockRemovePlatformRole = vi.fn();
const mockGetPlatformRole = vi.fn();

vi.mock('../../src/modules/access-control', () => ({
  listPlatformAdmins: (...args: any[]) => mockListPlatformAdmins(...args),
  setPlatformRole: (...args: any[]) => mockSetPlatformRole(...args),
  removePlatformRole: (...args: any[]) => mockRemovePlatformRole(...args),
  getPlatformRole: (...args: any[]) => mockGetPlatformRole(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockResolveUserNames = vi.fn();

vi.mock('../../src/api/helpers/user-resolver', () => ({
  resolveUserNames: (...args: any[]) => mockResolveUserNames(...args),
  resolveUserName: vi.fn().mockImplementation((id: string) => Promise.resolve(id)),
}));

import accessRoutes from '../../src/api/routes/access-control';

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
  app.use('/access', accessRoutes);
  return app;
}

// ── Tests ──

describe('Access Control Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolveUserNames returns userId as displayName
    mockResolveUserNames.mockImplementation(async (ids: string[]) => {
      const result: Record<string, string> = {};
      for (const id of ids) result[id] = id;
      return result;
    });
    app = createApp();
  });

  describe('GET /access/platform-roles', () => {
    it('lists platform admins with resolved display names', async () => {
      const admins = [{ user_id: 'U1', role: 'admin', granted_by: 'U2' }];
      mockListPlatformAdmins.mockResolvedValueOnce(admins);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice', U2: 'Bob' });

      const res = await makeRequest(app, 'GET', '/access/platform-roles');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{
        user_id: 'U1', role: 'admin', granted_by: 'U2',
        displayName: 'Alice', grantedByName: 'Bob',
      }]);
      expect(mockListPlatformAdmins).toHaveBeenCalledWith('W123');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/access/platform-roles');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Admin access required' });
    });

    it('returns 500 on error', async () => {
      mockListPlatformAdmins.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/access/platform-roles');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list platform admins' });
    });
  });

  describe('GET /access/platform-roles/:userId', () => {
    it('returns platform role for a user', async () => {
      mockGetPlatformRole.mockResolvedValueOnce('admin');

      const res = await makeRequest(app, 'GET', '/access/platform-roles/U456');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'U456', role: 'admin' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'GET', '/access/platform-roles/U456');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockGetPlatformRole.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/access/platform-roles/U456');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get platform role' });
    });
  });

  describe('PUT /access/platform-roles/:userId', () => {
    it('sets platform role (admin only)', async () => {
      mockSetPlatformRole.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PUT', '/access/platform-roles/U456', {
        role: 'admin',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSetPlatformRole).toHaveBeenCalledWith('W123', 'U456', 'admin', 'U123');
    });

    it('returns 400 when role is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/access/platform-roles/U456', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'role is required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'PUT', '/access/platform-roles/U456', {
        role: 'admin',
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockSetPlatformRole.mockRejectedValueOnce(new Error('Cannot change own role'));

      const res = await makeRequest(app, 'PUT', '/access/platform-roles/U456', {
        role: 'admin',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Cannot change own role' });
    });
  });

  describe('DELETE /access/platform-roles/:userId', () => {
    it('removes platform role (admin only)', async () => {
      mockRemovePlatformRole.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/access/platform-roles/U456');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockRemovePlatformRole).toHaveBeenCalledWith('W123', 'U456', 'U123');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp('member');

      const res = await makeRequest(memberApp, 'DELETE', '/access/platform-roles/U456');

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockRemovePlatformRole.mockRejectedValueOnce(new Error('Cannot remove self'));

      const res = await makeRequest(app, 'DELETE', '/access/platform-roles/U456');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Cannot remove self' });
    });
  });

  describe('superadmin access', () => {
    it('allows superadmin to access admin routes', async () => {
      const superadminApp = createApp('superadmin');
      mockListPlatformAdmins.mockResolvedValueOnce([]);

      const res = await makeRequest(superadminApp, 'GET', '/access/platform-roles');

      expect(res.status).toBe(200);
    });
  });
});
