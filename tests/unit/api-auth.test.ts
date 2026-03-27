import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockGetPlatformRole = vi.fn();

vi.mock('../../src/modules/access-control', () => ({
  getPlatformRole: (...args: any[]) => mockGetPlatformRole(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    slack: { clientId: 'test-client-id', clientSecret: 'test-client-secret' },
    oauth: { redirectBaseUrl: 'https://example.com' },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import authRoutes from '../../src/api/routes/auth';

// ── HTTP Test Helper ──

function makeRequest(
  app: express.Express,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, any>,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
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
          ...(headers || {}),
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let parsedBody: any;
          try {
            parsedBody = JSON.parse(data);
          } catch {
            parsedBody = data;
          }
          resolve({
            status: res.statusCode || 0,
            body: parsedBody,
            headers: res.headers as Record<string, string>,
          });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Tests ──

describe('Auth Routes', () => {
  let app: express.Express;
  let mockSession: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = {
      user: {
        userId: 'U123',
        workspaceId: 'W123',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        platformRole: 'admin',
      },
      destroy: vi.fn((cb: any) => cb()),
      save: vi.fn((cb: any) => cb()),
    };

    app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.session = mockSession;
      next();
    });
    app.use('/auth', authRoutes);
  });

  describe('GET /auth/me', () => {
    it('returns user when session exists', async () => {
      const res = await makeRequest(app, 'GET', '/auth/me');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 'U123',
        workspaceId: 'W123',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        platformRole: 'admin',
      });
    });

    it('returns 401 when no session user', async () => {
      mockSession.user = null;

      const res = await makeRequest(app, 'GET', '/auth/me');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
    });

    it('returns 401 when session is undefined', async () => {
      const noSessionApp = express();
      noSessionApp.use(express.json());
      noSessionApp.use((req: any, _res: any, next: any) => {
        req.session = null;
        next();
      });
      noSessionApp.use('/auth', authRoutes);

      const res = await makeRequest(noSessionApp, 'GET', '/auth/me');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Not authenticated' });
    });
  });

  describe('POST /auth/logout', () => {
    it('destroys session and returns ok', async () => {
      const res = await makeRequest(app, 'POST', '/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSession.destroy).toHaveBeenCalled();
    });

    it('returns ok when no session', async () => {
      const noSessionApp = express();
      noSessionApp.use(express.json());
      noSessionApp.use((req: any, _res: any, next: any) => {
        req.session = null;
        next();
      });
      noSessionApp.use('/auth', authRoutes);

      const res = await makeRequest(noSessionApp, 'POST', '/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 500 when session destroy fails', async () => {
      mockSession.destroy = vi.fn((cb: any) => cb(new Error('destroy failed')));

      const res = await makeRequest(app, 'POST', '/auth/logout');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Logout failed' });
    });
  });

  describe('GET /auth/slack', () => {
    it('redirects to Slack OAuth URL', async () => {
      const res = await makeRequest(app, 'GET', '/auth/slack');

      expect(res.status).toBe(302);
      const location = res.headers.location;
      expect(location).toContain('https://slack.com/oauth/v2/authorize');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('identity.basic');
    });

    it('returns 500 when client ID is not configured', async () => {
      const { config: appConfig } = await import('../../src/config');
      const origClientId = appConfig.slack.clientId;
      appConfig.slack.clientId = '';

      const res = await makeRequest(app, 'GET', '/auth/slack');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Something went wrong. Please try again.' });

      appConfig.slack.clientId = origClientId;
    });
  });

  describe('GET /auth/slack/callback', () => {
    it('returns 400 when code is missing', async () => {
      const res = await makeRequest(app, 'GET', '/auth/slack/callback');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Missing code parameter' });
    });

    it('returns 400 when token exchange fails', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: false, error: 'invalid_code' }),
      });

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=bad-code');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Authentication failed');

      globalThis.fetch = originalFetch;
    });

    it('returns 400 when no user access token returned', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ ok: true, authed_user: {} }),
      });

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=valid-code');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'No user access token returned' });

      globalThis.fetch = originalFetch;
    });

    it('returns 400 when identity fetch fails', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            ok: true,
            authed_user: { access_token: 'xoxp-token' },
          }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ ok: false, error: 'token_revoked' }),
        });

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=valid-code');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Authentication failed');

      globalThis.fetch = originalFetch;
    });

    it('returns 400 when user or workspace cannot be determined', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            ok: true,
            authed_user: { access_token: 'xoxp-token' },
          }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            ok: true,
            user: { id: null },
            team: { id: null },
          }),
        });

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=valid-code');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Could not determine user or workspace' });

      globalThis.fetch = originalFetch;
    });

    it('creates session and redirects on success', async () => {
      const originalFetch = globalThis.fetch;
      mockGetPlatformRole.mockResolvedValueOnce('admin');
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            ok: true,
            authed_user: { access_token: 'xoxp-token' },
          }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({
            ok: true,
            user: { id: 'U456', name: 'Jane', image_72: 'https://example.com/jane.png' },
            team: { id: 'W789' },
          }),
        });

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=valid-code');

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/');
      expect(mockSession.user).toEqual({
        userId: 'U456',
        workspaceId: 'W789',
        displayName: 'Jane',
        avatarUrl: 'https://example.com/jane.png',
        platformRole: 'admin',
      });

      globalThis.fetch = originalFetch;
    });

    it('returns 500 when fetch throws', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const res = await makeRequest(app, 'GET', '/auth/slack/callback?code=valid-code');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Something went wrong. Please try again in a moment.' });

      globalThis.fetch = originalFetch;
    });
  });
});
