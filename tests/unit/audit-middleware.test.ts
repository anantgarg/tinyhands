import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

const mockLogAuditEvent = vi.fn();

vi.mock('../../src/modules/audit', () => ({
  logAuditEvent: (...args: any[]) => mockLogAuditEvent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { auditMiddleware } from '../../src/api/middleware/audit';

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
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode || 500, body: data ? JSON.parse(data) : {} });
          } catch {
            resolve({ status: res.statusCode || 500, body: data });
          }
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

function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Simulate session user injection
  app.use((req: any, _res, next) => {
    req.sessionUser = {
      userId: 'U_TEST',
      workspaceId: 'W_TEST',
      displayName: 'Test User',
      avatarUrl: '',
      platformRole: 'admin',
    };
    next();
  });

  app.use(auditMiddleware);

  app.get('/api/v1/test', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/test', (_req, res) => res.json({ ok: true }));
  app.put('/api/v1/agents/:id', (_req, res) => res.json({ ok: true }));
  app.delete('/api/v1/test/:id', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/fail', (_req, res) => res.status(500).json({ error: 'fail' }));

  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auditMiddleware', () => {
  it('should not audit GET requests', async () => {
    const app = createApp();
    await makeRequest(app, 'GET', '/api/v1/test');

    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it('should audit POST requests on success', async () => {
    const app = createApp();
    await makeRequest(app, 'POST', '/api/v1/test', { data: 'value' });

    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'W_TEST',
        actorUserId: 'U_TEST',
        actorRole: 'admin',
        actionType: 'dashboard_api',
      }),
    );
  });

  it('should audit PUT requests', async () => {
    const app = createApp();
    await makeRequest(app, 'PUT', '/api/v1/agents/abc-123-def', { name: 'new' });

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('should audit DELETE requests', async () => {
    const app = createApp();
    await makeRequest(app, 'DELETE', '/api/v1/test/some-id');

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('should not audit failed requests (status >= 400)', async () => {
    const app = createApp();
    await makeRequest(app, 'POST', '/api/v1/fail');

    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it('should not throw when session user is missing', async () => {
    const app = express();
    app.use(express.json());
    // No session user injected
    app.use(auditMiddleware);
    app.post('/test', (_req, res) => res.json({ ok: true }));

    const result = await makeRequest(app, 'POST', '/test');

    expect(result.status).toBe(200);
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  it('should include method and path in details', async () => {
    const app = createApp();
    await makeRequest(app, 'POST', '/api/v1/test', {});

    const callArgs = mockLogAuditEvent.mock.calls[0][0];
    expect(callArgs.details).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
