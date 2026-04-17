import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockGetMetrics = vi.fn();

vi.mock('../../src/modules/dashboard', () => ({
  getMetrics: (...args: any[]) => mockGetMetrics(...args),
}));

const mockListAgents = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  listAgents: (...args: any[]) => mockListAgents(...args),
}));

// getRecentRuns no longer used — recent-runs uses direct JOIN query via mockQuery

const mockGetAuditLog = vi.fn();

vi.mock('../../src/modules/audit', () => ({
  getAuditLog: (...args: any[]) => mockGetAuditLog(...args),
}));

const mockQuery = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockResolveUserNames = vi.fn();

vi.mock('../../src/api/helpers/user-resolver', () => ({
  resolveUserNames: (...args: any[]) => mockResolveUserNames(...args),
  resolveUserName: vi.fn().mockImplementation((id: string) => Promise.resolve(id)),
}));

import dashboardRoutes from '../../src/api/routes/dashboard';

// ── HTTP Test Helper ──

function makeRequest(
  app: express.Express,
  method: string,
  path: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }

      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
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
      req.end();
    });
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.sessionUser = {
      userId: 'U123',
      workspaceId: 'W123',
      displayName: 'Test User',
      avatarUrl: 'https://example.com/avatar.png',
      platformRole: 'admin',
    };
    next();
  });
  app.use('/dashboard', dashboardRoutes);
  return app;
}

// ── Tests ──

describe('Dashboard Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set safe defaults so unhandled calls don't crash
    mockGetMetrics.mockResolvedValue({});
    mockListAgents.mockResolvedValue([]);
    mockGetAuditLog.mockResolvedValue([]);
    mockQuery.mockResolvedValue([]);
    // Default: resolveUserNames returns userId as displayName
    mockResolveUserNames.mockImplementation(async (ids: string[]) => {
      const result: Record<string, string> = {};
      for (const id of ids) result[id] = id;
      return result;
    });
    app = createApp();
  });

  describe('GET /dashboard/metrics', () => {
    it('returns metrics with default days=30', async () => {
      const metrics = { totalRuns: 100, totalCost: 5.5 };
      mockGetMetrics.mockResolvedValueOnce(metrics);

      const res = await makeRequest(app, 'GET', '/dashboard/metrics');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(metrics);
      expect(mockGetMetrics).toHaveBeenCalledWith('W123', 30);
    });

    it('uses custom days parameter', async () => {
      mockGetMetrics.mockResolvedValueOnce({});

      await makeRequest(app, 'GET', '/dashboard/metrics?days=7');

      expect(mockGetMetrics).toHaveBeenCalledWith('W123', 7);
    });

    it('returns 500 on error', async () => {
      mockGetMetrics.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/metrics');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch metrics' });
    });
  });

  describe('GET /dashboard/power-users', () => {
    it('returns top users with resolved display names', async () => {
      mockQuery.mockResolvedValueOnce([
        { slack_user_id: 'U1', run_count: '10', agent_names: ['Bot1', 'Bot2'] },
      ]);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice' });

      const res = await makeRequest(app, 'GET', '/dashboard/power-users');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { userId: 'U1', displayName: 'Alice', runCount: 10, agentNames: ['Bot1', 'Bot2'] },
      ]);
      expect(mockResolveUserNames).toHaveBeenCalledWith(['U1'], expect.any(String));
    });

    it('handles null agent_names', async () => {
      mockQuery.mockResolvedValueOnce([
        { slack_user_id: 'U1', run_count: '5', agent_names: null },
      ]);

      const res = await makeRequest(app, 'GET', '/dashboard/power-users');

      expect(res.status).toBe(200);
      expect(res.body[0].agentNames).toEqual([]);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/power-users');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch power users' });
    });
  });

  describe('GET /dashboard/agent-creators', () => {
    it('returns top creators with resolved display names', async () => {
      mockQuery.mockResolvedValueOnce([
        { created_by: 'U1', agent_count: '3', agent_names: ['Bot1'] },
      ]);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Bob' });

      const res = await makeRequest(app, 'GET', '/dashboard/agent-creators');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { userId: 'U1', displayName: 'Bob', agentCount: 3, agentNames: ['Bot1'] },
      ]);
      expect(mockResolveUserNames).toHaveBeenCalledWith(['U1'], expect.any(String));
    });

    it('handles null agent_names', async () => {
      mockQuery.mockResolvedValueOnce([
        { created_by: 'U1', agent_count: '1', agent_names: null },
      ]);

      const res = await makeRequest(app, 'GET', '/dashboard/agent-creators');

      expect(res.status).toBe(200);
      expect(res.body[0].agentNames).toEqual([]);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/agent-creators');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch agent creators' });
    });
  });

  describe('GET /dashboard/popular-agents', () => {
    it('returns popular agents', async () => {
      mockQuery.mockResolvedValueOnce([
        { agent_id: 'a1', name: 'Bot1', avatar_emoji: '🤖', run_count: '50', total_cost: '2.5' },
      ]);

      const res = await makeRequest(app, 'GET', '/dashboard/popular-agents');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { agentId: 'a1', name: 'Bot1', avatarEmoji: '🤖', runCount: 50, totalCost: 2.5 },
      ]);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/popular-agents');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch popular agents' });
    });
  });

  describe('GET /dashboard/fleet', () => {
    it('returns agent fleet', async () => {
      const agents = [{ id: 'a1', name: 'Bot1' }];
      mockListAgents.mockResolvedValueOnce(agents);

      const res = await makeRequest(app, 'GET', '/dashboard/fleet');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(agents);
      expect(mockListAgents).toHaveBeenCalledWith('W123');
    });

    it('returns 500 on error', async () => {
      mockListAgents.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/fleet');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch agent fleet' });
    });
  });

  describe('GET /dashboard/recent-runs', () => {
    it('returns recent runs with agent names and resolved display names', async () => {
      const runs = [{
        id: 'r1', trace_id: 'tr1', agent_name: 'Bot1', agent_avatar: '',
        slack_user_id: 'U1', status: 'completed', model: 'claude-sonnet-4-20250514',
        estimated_cost_usd: '0.05', duration_ms: 1000, output: null, created_at: '2025-01-01',
      }];
      mockQuery.mockResolvedValueOnce(runs);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice' });

      const res = await makeRequest(app, 'GET', '/dashboard/recent-runs');

      expect(res.status).toBe(200);
      expect(res.body[0].agentName).toBe('Bot1');
      expect(res.body[0].displayName).toBe('Alice');
      expect(res.body[0].cost).toBe(0.05);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/recent-runs');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch recent runs' });
    });
  });

  describe('GET /dashboard/recent-activity', () => {
    it('returns audit entries with proper field mapping and resolved names', async () => {
      const entries = [{ id: 'e1', action: 'create', action_type: 'create_agent', actor_user_id: 'U1', metadata: { foo: 'bar' }, created_at: '2025-01-01' }];
      mockGetAuditLog.mockResolvedValueOnce(entries);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice' });

      const res = await makeRequest(app, 'GET', '/dashboard/recent-activity');

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('e1');
      expect(res.body[0].action).toBe('create');
      expect(res.body[0].displayName).toBe('Alice');
      expect(res.body[0].userId).toBe('U1');
      expect(res.body[0].createdAt).toBe('2025-01-01');
      expect(mockGetAuditLog).toHaveBeenCalledWith('W123', { limit: 10 });
    });

    it('uses custom limit', async () => {
      mockGetAuditLog.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/dashboard/recent-activity?limit=25');

      expect(mockGetAuditLog).toHaveBeenCalledWith('W123', { limit: 25 });
    });

    it('returns 500 on error', async () => {
      mockGetAuditLog.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/dashboard/recent-activity');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch recent activity' });
    });
  });
});
