import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockListAgents = vi.fn();
const mockGetAccessibleAgents = vi.fn();
const mockCreateAgent = vi.fn();
const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
const mockDeleteAgent = vi.fn();
const mockGetAgentVersions = vi.fn();
const mockRevertAgent = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  createAgent: (...args: any[]) => mockCreateAgent(...args),
  getAgent: (...args: any[]) => mockGetAgent(...args),
  listAgents: (...args: any[]) => mockListAgents(...args),
  getAccessibleAgents: (...args: any[]) => mockGetAccessibleAgents(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
  deleteAgent: (...args: any[]) => mockDeleteAgent(...args),
  getAgentVersions: (...args: any[]) => mockGetAgentVersions(...args),
  revertAgent: (...args: any[]) => mockRevertAgent(...args),
}));

const mockCanModifyAgent = vi.fn();
const mockCanView = vi.fn();
const mockGetAgentRole = vi.fn();
const mockSetAgentRole = vi.fn();
const mockRemoveAgentRole = vi.fn();
const mockGetAgentRoles = vi.fn();
const mockRequestUpgrade = vi.fn();
const mockApproveUpgrade = vi.fn();
const mockDenyUpgrade = vi.fn();

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
  canView: (...args: any[]) => mockCanView(...args),
  getAgentRole: (...args: any[]) => mockGetAgentRole(...args),
  setAgentRole: (...args: any[]) => mockSetAgentRole(...args),
  removeAgentRole: (...args: any[]) => mockRemoveAgentRole(...args),
  getAgentRoles: (...args: any[]) => mockGetAgentRoles(...args),
  requestUpgrade: (...args: any[]) => mockRequestUpgrade(...args),
  approveUpgrade: (...args: any[]) => mockApproveUpgrade(...args),
  denyUpgrade: (...args: any[]) => mockDenyUpgrade(...args),
}));

const mockGetRunsByAgent = vi.fn();

vi.mock('../../src/modules/execution', () => ({
  getRunsByAgent: (...args: any[]) => mockGetRunsByAgent(...args),
}));

const mockAddToolToAgent = vi.fn();
const mockRemoveToolFromAgent = vi.fn();
const mockGetAgentToolSummary = vi.fn();

vi.mock('../../src/modules/tools', () => ({
  addToolToAgent: (...args: any[]) => mockAddToolToAgent(...args),
  removeToolFromAgent: (...args: any[]) => mockRemoveToolFromAgent(...args),
  getAgentToolSummary: (...args: any[]) => mockGetAgentToolSummary(...args),
}));

const mockAttachSkillToAgent = vi.fn();
const mockDetachSkillFromAgent = vi.fn();
const mockGetAgentSkills = vi.fn();

vi.mock('../../src/modules/skills', () => ({
  attachSkillToAgent: (...args: any[]) => mockAttachSkillToAgent(...args),
  detachSkillFromAgent: (...args: any[]) => mockDetachSkillFromAgent(...args),
  getAgentSkills: (...args: any[]) => mockGetAgentSkills(...args),
}));

const mockGetAgentTriggers = vi.fn();

vi.mock('../../src/modules/triggers', () => ({
  getAgentTriggers: (...args: any[]) => mockGetAgentTriggers(...args),
}));

const mockCheckPromptSize = vi.fn();

vi.mock('../../src/modules/self-improvement', () => ({
  checkPromptSize: (...args: any[]) => mockCheckPromptSize(...args),
  generatePromptDiff: vi.fn(),
  applyPromptDiff: vi.fn(),
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

import agentRoutes from '../../src/api/routes/agents';

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
  app.use('/agents', agentRoutes);
  return app;
}

// ── Tests ──

describe('Agent Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolveUserNames returns userId as displayName
    mockResolveUserNames.mockImplementation(async (ids: string[]) => {
      const result: Record<string, string> = {};
      for (const id of ids) result[id] = id;
      return result;
    });
    // Default: canView returns true (tests that need false must override)
    mockCanView.mockResolvedValue(true);
    app = createApp();
  });

  // ── GET /agents ──

  describe('GET /agents', () => {
    it('calls listAgents for admin users', async () => {
      const agents = [{ id: 'a1', name: 'Bot1' }];
      mockListAgents.mockResolvedValueOnce(agents);

      const res = await makeRequest(app, 'GET', '/agents');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(agents);
      expect(mockListAgents).toHaveBeenCalledWith('W123');
    });

    it('calls getAccessibleAgents for non-admin users', async () => {
      const memberApp = createApp('member');
      const agents = [{ id: 'a2', name: 'Bot2' }];
      mockGetAccessibleAgents.mockResolvedValueOnce(agents);

      const res = await makeRequest(memberApp, 'GET', '/agents');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(agents);
      expect(mockGetAccessibleAgents).toHaveBeenCalledWith('W123', 'U123');
    });

    it('calls listAgents for superadmin users', async () => {
      const superadminApp = createApp('superadmin');
      mockListAgents.mockResolvedValueOnce([]);

      const res = await makeRequest(superadminApp, 'GET', '/agents');

      expect(res.status).toBe(200);
      expect(mockListAgents).toHaveBeenCalledWith('W123');
    });

    it('returns 500 on error', async () => {
      mockListAgents.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list agents' });
    });
  });

  // ── GET /agents/:id ──

  describe('GET /agents/:id', () => {
    it('returns agent when found and user can view', async () => {
      const agent = { id: 'a1', name: 'Bot1' };
      mockGetAgent.mockResolvedValueOnce(agent);
      mockCanView.mockResolvedValueOnce(true);

      const res = await makeRequest(app, 'GET', '/agents/a1');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(agent);
      expect(res.body.channel_names).toEqual({});
    });

    it('returns 404 when agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/agents/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });

    it('returns 403 when user cannot view', async () => {
      mockGetAgent.mockResolvedValueOnce({ id: 'a1' });
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns 500 on error', async () => {
      mockGetAgent.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get agent' });
    });
  });

  // ── POST /agents ──

  describe('POST /agents', () => {
    it('creates an agent', async () => {
      const newAgent = { id: 'a1', name: 'NewBot' };
      mockCreateAgent.mockResolvedValueOnce(newAgent);

      const res = await makeRequest(app, 'POST', '/agents', {
        name: 'NewBot',
        channelId: 'C123',
        systemPrompt: 'You are helpful',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(newAgent);
      expect(mockCreateAgent).toHaveBeenCalledWith('W123', expect.objectContaining({
        name: 'NewBot',
        createdBy: 'U123',
      }));
    });

    it('returns 400 on error', async () => {
      mockCreateAgent.mockRejectedValueOnce(new Error('Agent name already exists'));

      const res = await makeRequest(app, 'POST', '/agents', { name: 'Dup' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't create the agent. Please try again." });
    });
  });

  // ── PATCH /agents/:id ──

  describe('PATCH /agents/:id', () => {
    it('updates agent when user can modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const updated = { id: 'a1', name: 'Updated' };
      mockUpdateAgent.mockResolvedValueOnce(updated);

      const res = await makeRequest(app, 'PATCH', '/agents/a1', { name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(updated);
      expect(mockUpdateAgent).toHaveBeenCalledWith('W123', 'a1', { name: 'Updated' }, 'U123');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'PATCH', '/agents/a1', { name: 'Updated' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns 400 on error', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockUpdateAgent.mockRejectedValueOnce(new Error('Invalid field'));

      const res = await makeRequest(app, 'PATCH', '/agents/a1', { bad: true });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't update the agent. Please try again." });
    });
  });

  // ── DELETE /agents/:id ──

  describe('DELETE /agents/:id', () => {
    it('deletes agent when user can modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockDeleteAgent.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/agents/a1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockDeleteAgent).toHaveBeenCalledWith('W123', 'a1');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'DELETE', '/agents/a1');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns 500 on error', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockDeleteAgent.mockRejectedValueOnce(new Error('Cannot delete'));

      const res = await makeRequest(app, 'DELETE', '/agents/a1');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to delete agent' });
    });
  });

  // ── GET /agents/:id/versions ──

  describe('GET /agents/:id/versions', () => {
    it('returns versions when user can view', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const versions = [{ version: 1, changed_by: 'U1' }, { version: 2, changed_by: 'U2' }];
      mockGetAgentVersions.mockResolvedValueOnce(versions);

      const res = await makeRequest(app, 'GET', '/agents/a1/versions');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].version).toBe(1);
      expect(res.body[1].version).toBe(2);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/versions');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockGetAgentVersions.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/versions');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get versions' });
    });
  });

  // ── POST /agents/:id/revert ──

  describe('POST /agents/:id/revert', () => {
    it('reverts agent to version', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      const reverted = { id: 'a1', version: 1 };
      mockRevertAgent.mockResolvedValueOnce(reverted);

      const res = await makeRequest(app, 'POST', '/agents/a1/revert', { version: 1 });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(reverted);
      expect(mockRevertAgent).toHaveBeenCalledWith('W123', 'a1', 1, 'U123');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'POST', '/agents/a1/revert', { version: 1 });

      expect(res.status).toBe(403);
    });

    it('returns 400 when version is missing', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);

      const res = await makeRequest(app, 'POST', '/agents/a1/revert', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'version is required' });
    });

    it('returns 400 on error', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockRevertAgent.mockRejectedValueOnce(new Error('Version not found'));

      const res = await makeRequest(app, 'POST', '/agents/a1/revert', { version: 99 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't revert the agent. Please try again." });
    });
  });

  // ── GET /agents/:id/runs ──

  describe('GET /agents/:id/runs', () => {
    it('returns paginated runs with resolved display names', async () => {
      mockCanView.mockResolvedValueOnce(true);
      // First query call: count
      mockQuery.mockResolvedValueOnce([{ count: 2 }]);
      // Second query call: runs
      const runs = [{ id: 'r1', slack_user_id: 'U1' }, { id: 'r2', slack_user_id: 'U2' }];
      mockQuery.mockResolvedValueOnce(runs);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice', U2: 'Bob' });

      const res = await makeRequest(app, 'GET', '/agents/a1/runs?limit=10');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        runs: [
          { id: 'r1', slack_user_id: 'U1', displayName: 'Alice' },
          { id: 'r2', slack_user_id: 'U2', displayName: 'Bob' },
        ],
        total: 2,
      });
    });

    it('uses default limit of 20 and returns { runs, total }', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockQuery.mockResolvedValueOnce([{ count: 0 }]);
      mockQuery.mockResolvedValueOnce([]);
      mockResolveUserNames.mockResolvedValueOnce({});

      const res = await makeRequest(app, 'GET', '/agents/a1/runs');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ runs: [], total: 0 });
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/runs');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/runs');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get runs' });
    });
  });

  // ── GET /agents/:id/memories ──

  describe('GET /agents/:id/memories', () => {
    it('returns memories', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const memories = [{ id: 'm1', fact: 'something' }];
      mockQuery.mockResolvedValueOnce(memories);

      const res = await makeRequest(app, 'GET', '/agents/a1/memories');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(memories);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/memories');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/memories');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get memories' });
    });
  });

  // ── GET /agents/:id/roles ──

  describe('GET /agents/:id/roles', () => {
    it('returns roles with resolved display names', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const roles = [{ user_id: 'U1', role: 'owner', granted_by: 'U2' }];
      mockGetAgentRoles.mockResolvedValueOnce(roles);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice', U2: 'Bob' });

      const res = await makeRequest(app, 'GET', '/agents/a1/roles');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{
        user_id: 'U1', role: 'owner', granted_by: 'U2',
        displayName: 'Alice', grantedByName: 'Bob',
      }]);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/roles');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockGetAgentRoles.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/roles');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get roles' });
    });
  });

  // ── POST /agents/:id/roles ──

  describe('POST /agents/:id/roles', () => {
    it('assigns role when user can modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockSetAgentRole.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/agents/a1/roles', {
        targetUserId: 'U456',
        role: 'member',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSetAgentRole).toHaveBeenCalledWith('W123', 'a1', 'U456', 'member', 'U123');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'POST', '/agents/a1/roles', {
        targetUserId: 'U456',
        role: 'member',
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 when targetUserId or role is missing', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);

      const res = await makeRequest(app, 'POST', '/agents/a1/roles', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'targetUserId and role are required' });
    });

    it('returns 400 on error', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockSetAgentRole.mockRejectedValueOnce(new Error('Invalid role'));

      const res = await makeRequest(app, 'POST', '/agents/a1/roles', {
        targetUserId: 'U456',
        role: 'invalid',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't update the role. Please try again." });
    });
  });

  // ── DELETE /agents/:id/roles/:userId ──

  describe('DELETE /agents/:id/roles/:targetUserId', () => {
    it('removes role when user can modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockRemoveAgentRole.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/agents/a1/roles/U456');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockRemoveAgentRole).toHaveBeenCalledWith('W123', 'a1', 'U456');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'DELETE', '/agents/a1/roles/U456');

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockRemoveAgentRole.mockRejectedValueOnce(new Error('Role not found'));

      const res = await makeRequest(app, 'DELETE', '/agents/a1/roles/U456');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't remove the role. Please try again." });
    });
  });

  // ── GET /agents/:id/tools ──

  describe('GET /agents/:id/tools', () => {
    it('returns tool summary', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const summary = { tools: ['tool1', 'tool2'] };
      mockGetAgentToolSummary.mockResolvedValueOnce(summary);

      const res = await makeRequest(app, 'GET', '/agents/a1/tools');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(summary);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/tools');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockGetAgentToolSummary.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/tools');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get tool summary' });
    });
  });

  // ── POST /agents/:id/tools ──

  describe('POST /agents/:id/tools', () => {
    it('adds tool to agent', async () => {
      const tools = ['tool1', 'tool2'];
      mockAddToolToAgent.mockResolvedValueOnce(tools);

      const res = await makeRequest(app, 'POST', '/agents/a1/tools', { toolName: 'tool2' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tools });
      expect(mockAddToolToAgent).toHaveBeenCalledWith('W123', 'a1', 'tool2', 'U123');
    });

    it('returns 400 when toolName is missing', async () => {
      const res = await makeRequest(app, 'POST', '/agents/a1/tools', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'toolName is required' });
    });

    it('returns 400 on error', async () => {
      mockAddToolToAgent.mockRejectedValueOnce(new Error('Tool not found'));

      const res = await makeRequest(app, 'POST', '/agents/a1/tools', { toolName: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't add the tool. Please try again." });
    });
  });

  // ── DELETE /agents/:id/tools/:toolName ──

  describe('DELETE /agents/:id/tools/:toolName', () => {
    it('removes tool from agent', async () => {
      const tools = ['tool1'];
      mockRemoveToolFromAgent.mockResolvedValueOnce(tools);

      const res = await makeRequest(app, 'DELETE', '/agents/a1/tools/tool2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tools });
      expect(mockRemoveToolFromAgent).toHaveBeenCalledWith('W123', 'a1', 'tool2', 'U123');
    });

    it('returns 400 on error', async () => {
      mockRemoveToolFromAgent.mockRejectedValueOnce(new Error('Tool not on agent'));

      const res = await makeRequest(app, 'DELETE', '/agents/a1/tools/bad');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't remove the tool. Please try again." });
    });
  });

  // ── GET /agents/:id/skills ──

  describe('GET /agents/:id/skills', () => {
    it('returns agent skills', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const skills = [{ id: 's1', name: 'Skill1' }];
      mockGetAgentSkills.mockResolvedValueOnce(skills);

      const res = await makeRequest(app, 'GET', '/agents/a1/skills');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(skills);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/skills');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockGetAgentSkills.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/skills');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get skills' });
    });
  });

  // ── POST /agents/:id/skills ──

  describe('POST /agents/:id/skills', () => {
    it('attaches skill to agent', async () => {
      const agentSkill = { id: 'as1', skillName: 'analysis' };
      mockAttachSkillToAgent.mockResolvedValueOnce(agentSkill);

      const res = await makeRequest(app, 'POST', '/agents/a1/skills', {
        skillName: 'analysis',
        permissionLevel: 'write',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(agentSkill);
      expect(mockAttachSkillToAgent).toHaveBeenCalledWith('W123', 'a1', 'analysis', 'write', 'U123');
    });

    it('uses default permission level of read', async () => {
      mockAttachSkillToAgent.mockResolvedValueOnce({});

      await makeRequest(app, 'POST', '/agents/a1/skills', { skillName: 'analysis' });

      expect(mockAttachSkillToAgent).toHaveBeenCalledWith('W123', 'a1', 'analysis', 'read', 'U123');
    });

    it('returns 400 when skillName is missing', async () => {
      const res = await makeRequest(app, 'POST', '/agents/a1/skills', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'skillName is required' });
    });

    it('returns 400 on error', async () => {
      mockAttachSkillToAgent.mockRejectedValueOnce(new Error('Skill not found'));

      const res = await makeRequest(app, 'POST', '/agents/a1/skills', { skillName: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't attach the skill. Please try again." });
    });
  });

  // ── DELETE /agents/:id/skills/:skillId ──

  describe('DELETE /agents/:id/skills/:skillId', () => {
    it('detaches skill from agent', async () => {
      mockDetachSkillFromAgent.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/agents/a1/skills/s1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockDetachSkillFromAgent).toHaveBeenCalledWith('W123', 'a1', 's1', 'U123');
    });

    it('returns 400 on error', async () => {
      mockDetachSkillFromAgent.mockRejectedValueOnce(new Error('Skill not attached'));

      const res = await makeRequest(app, 'DELETE', '/agents/a1/skills/bad');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't remove the skill. Please try again." });
    });
  });

  // ── GET /agents/:id/access ──

  describe('GET /agents/:id/access', () => {
    it('returns current user access level', async () => {
      mockGetAgentRole.mockResolvedValueOnce('owner');

      const res = await makeRequest(app, 'GET', '/agents/a1/access');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ role: 'owner' });
    });

    it('returns 500 on error', async () => {
      mockGetAgentRole.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/access');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get access level' });
    });
  });

  // ── POST /agents/:id/upgrade-requests ──

  describe('POST /agents/:id/upgrade-requests', () => {
    it('creates upgrade request', async () => {
      mockRequestUpgrade.mockResolvedValueOnce('ur-1');

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests', {
        reason: 'Need write access',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: 'ur-1' });
    });

    it('returns 400 on error', async () => {
      mockRequestUpgrade.mockRejectedValueOnce(new Error('Already requested'));

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't submit the upgrade request. Please try again." });
    });
  });

  // ── POST /agents/:id/upgrade-requests/:requestId/approve ──

  describe('POST /agents/:id/upgrade-requests/:requestId/approve', () => {
    it('approves upgrade request', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockApproveUpgrade.mockResolvedValueOnce({ ok: true });

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests/ur-1/approve');

      expect(res.status).toBe(200);
      expect(mockApproveUpgrade).toHaveBeenCalledWith('W123', 'ur-1', 'U123');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests/ur-1/approve');

      expect(res.status).toBe(403);
    });
  });

  // ── POST /agents/:id/upgrade-requests/:requestId/deny ──

  describe('POST /agents/:id/upgrade-requests/:requestId/deny', () => {
    it('denies upgrade request', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockDenyUpgrade.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests/ur-1/deny');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockDenyUpgrade).toHaveBeenCalledWith('W123', 'ur-1', 'U123');
    });

    it('returns 403 when user cannot modify', async () => {
      mockCanModifyAgent.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'POST', '/agents/a1/upgrade-requests/ur-1/deny');

      expect(res.status).toBe(403);
    });
  });

  // ── GET /agents/:id/triggers ──

  describe('GET /agents/:id/triggers', () => {
    it('returns agent triggers', async () => {
      mockCanView.mockResolvedValueOnce(true);
      const triggers = [{ id: 't1', type: 'webhook' }];
      mockGetAgentTriggers.mockResolvedValueOnce(triggers);

      const res = await makeRequest(app, 'GET', '/agents/a1/triggers');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(triggers);
    });

    it('returns 403 when user cannot view', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/triggers');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockGetAgentTriggers.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/agents/a1/triggers');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get triggers' });
    });
  });

  describe('GET /agents/:id/prompt-size', () => {
    it('returns prompt size for agent', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockCheckPromptSize.mockResolvedValueOnce({ tokenCount: 2500, warning: false });

      const res = await makeRequest(app, 'GET', '/agents/a1/prompt-size');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ tokenCount: 2500, warning: false });
    });

    it('returns warning when prompt is large', async () => {
      mockCanView.mockResolvedValueOnce(true);
      mockCheckPromptSize.mockResolvedValueOnce({ tokenCount: 5000, warning: true });

      const res = await makeRequest(app, 'GET', '/agents/a1/prompt-size');

      expect(res.status).toBe(200);
      expect(res.body.warning).toBe(true);
    });

    it('returns 403 when not authorized', async () => {
      mockCanView.mockResolvedValueOnce(false);

      const res = await makeRequest(app, 'GET', '/agents/a1/prompt-size');

      expect(res.status).toBe(403);
    });
  });
});
