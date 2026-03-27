import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

// Connections
const mockListTeamConnections = vi.fn();
const mockListPersonalConnectionsForUser = vi.fn();
const mockCreateTeamConnection = vi.fn();
const mockCreatePersonalConnection = vi.fn();
const mockDeleteConnection = vi.fn();
const mockListAgentToolConnections = vi.fn();
const mockSetAgentToolConnection = vi.fn();
const mockGetToolAgentUsage = vi.fn();

vi.mock('../../src/modules/connections', () => ({
  listTeamConnections: (...args: any[]) => mockListTeamConnections(...args),
  listPersonalConnectionsForUser: (...args: any[]) => mockListPersonalConnectionsForUser(...args),
  createTeamConnection: (...args: any[]) => mockCreateTeamConnection(...args),
  createPersonalConnection: (...args: any[]) => mockCreatePersonalConnection(...args),
  deleteConnection: (...args: any[]) => mockDeleteConnection(...args),
  listAgentToolConnections: (...args: any[]) => mockListAgentToolConnections(...args),
  setAgentToolConnection: (...args: any[]) => mockSetAgentToolConnection(...args),
  getToolAgentUsage: (...args: any[]) => mockGetToolAgentUsage(...args),
  getIntegrationIdForTool: (name: string) => name.split('-')[0],
}));

const mockGetAgent = vi.fn();
vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
}));

// Triggers
const mockCreateTrigger = vi.fn();
const mockGetTrigger = vi.fn();
const mockGetActiveTriggersByType = vi.fn();
const mockPauseTrigger = vi.fn();
const mockResumeTrigger = vi.fn();
const mockDeleteTrigger = vi.fn();

vi.mock('../../src/modules/triggers', () => ({
  createTrigger: (...args: any[]) => mockCreateTrigger(...args),
  getTrigger: (...args: any[]) => mockGetTrigger(...args),
  getActiveTriggersByType: (...args: any[]) => mockGetActiveTriggersByType(...args),
  pauseTrigger: (...args: any[]) => mockPauseTrigger(...args),
  resumeTrigger: (...args: any[]) => mockResumeTrigger(...args),
  deleteTrigger: (...args: any[]) => mockDeleteTrigger(...args),
}));

// Workflows
const mockCreateWorkflowDefinition = vi.fn();
const mockGetWorkflowDefinition = vi.fn();
const mockStartWorkflow = vi.fn();
const mockGetWorkflowRun = vi.fn();
const mockResolveHumanAction = vi.fn();

vi.mock('../../src/modules/workflows', () => ({
  createWorkflowDefinition: (...args: any[]) => mockCreateWorkflowDefinition(...args),
  getWorkflowDefinition: (...args: any[]) => mockGetWorkflowDefinition(...args),
  startWorkflow: (...args: any[]) => mockStartWorkflow(...args),
  getWorkflowRun: (...args: any[]) => mockGetWorkflowRun(...args),
  resolveHumanAction: (...args: any[]) => mockResolveHumanAction(...args),
}));

// Evolution
const mockGetPendingProposals = vi.fn();
const mockGetProposalHistory = vi.fn();
const mockApproveProposal = vi.fn();
const mockRejectProposal = vi.fn();

vi.mock('../../src/modules/self-evolution', () => ({
  getPendingProposals: (...args: any[]) => mockGetPendingProposals(...args),
  getProposalHistory: (...args: any[]) => mockGetProposalHistory(...args),
  approveProposal: (...args: any[]) => mockApproveProposal(...args),
  rejectProposal: (...args: any[]) => mockRejectProposal(...args),
}));

// Audit
const mockGetAuditLog = vi.fn();

vi.mock('../../src/modules/audit', () => ({
  getAuditLog: (...args: any[]) => mockGetAuditLog(...args),
}));

// Settings
const mockGetAllSettings = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('../../src/modules/workspace-settings', () => ({
  getAllSettings: (...args: any[]) => mockGetAllSettings(...args),
  setSetting: (...args: any[]) => mockSetSetting(...args),
}));

// Slack
const mockGetSlackApp = vi.fn();

vi.mock('../../src/slack', () => ({
  getSlackApp: () => mockGetSlackApp(),
}));

// Observability
const mockGetAlertRules = vi.fn();
const mockCheckAlerts = vi.fn();
const mockGetAgentErrorRates = vi.fn();

vi.mock('../../src/modules/observability', () => ({
  getAlertRules: (...args: any[]) => mockGetAlertRules(...args),
  checkAlerts: (...args: any[]) => mockCheckAlerts(...args),
  getAgentErrorRates: (...args: any[]) => mockGetAgentErrorRates(...args),
}));

// Skills
const mockGetAvailableSkills = vi.fn();
const mockListSkills = vi.fn();

vi.mock('../../src/modules/skills', () => ({
  getAvailableSkills: (...args: any[]) => mockGetAvailableSkills(...args),
  listSkills: (...args: any[]) => mockListSkills(...args),
}));

// Execution
const mockGetRecentRuns = vi.fn();
const mockGetRunRecord = vi.fn();

vi.mock('../../src/modules/execution', () => ({
  getRecentRuns: (...args: any[]) => mockGetRecentRuns(...args),
  getRunRecord: (...args: any[]) => mockGetRunRecord(...args),
}));

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockResolveUserNames = vi.fn();

vi.mock('../../src/api/helpers/user-resolver', () => ({
  resolveUserNames: (...args: any[]) => mockResolveUserNames(...args),
  resolveUserName: vi.fn().mockImplementation((id: string) => Promise.resolve(id)),
}));

import connectionRoutes from '../../src/api/routes/connections';
import triggerRoutes from '../../src/api/routes/triggers';
import workflowRoutes from '../../src/api/routes/workflows';
import evolutionRoutes from '../../src/api/routes/evolution';
import auditRoutes from '../../src/api/routes/audit';
import settingsRoutes from '../../src/api/routes/settings';
import slackHelperRoutes from '../../src/api/routes/slack-helpers';
import observabilityRoutes from '../../src/api/routes/observability';
import skillRoutes from '../../src/api/routes/skills';
import runRoutes from '../../src/api/routes/runs';

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

function createApp(routes: express.Router, basePath: string, platformRole: string = 'admin') {
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
  app.use(basePath, routes);
  return app;
}

// ── Tests ──

// ────────────────────────────────────────────────
// Connections
// ────────────────────────────────────────────────

describe('Connection Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(connectionRoutes, '/connections');
  });

  describe('GET /connections/team', () => {
    it('lists team connections for admin', async () => {
      const connections = [{ id: 'c1', integration_id: 'linear' }];
      mockListTeamConnections.mockResolvedValueOnce(connections);

      const res = await makeRequest(app, 'GET', '/connections/team');

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('c1');
      expect(res.body[0].type).toBe('team');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(connectionRoutes, '/connections', 'member');

      const res = await makeRequest(memberApp, 'GET', '/connections/team');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockListTeamConnections.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/connections/team');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list team connections' });
    });
  });

  describe('GET /connections/personal', () => {
    it('lists personal connections for current user', async () => {
      const connections = [{ id: 'c2', integration_id: 'github', user_id: 'U123' }];
      mockListPersonalConnectionsForUser.mockResolvedValueOnce(connections);
      mockResolveUserNames.mockResolvedValueOnce({ U123: 'Test User' });

      const res = await makeRequest(app, 'GET', '/connections/personal');

      expect(res.status).toBe(200);
      expect(res.body[0].id).toBe('c2');
      expect(res.body[0].type).toBe('personal');
      expect(mockListPersonalConnectionsForUser).toHaveBeenCalledWith('W123', 'U123');
    });

    it('returns 500 on error', async () => {
      mockListPersonalConnectionsForUser.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/connections/personal');

      expect(res.status).toBe(500);
    });
  });

  describe('POST /connections/team', () => {
    it('creates team connection (admin)', async () => {
      const conn = { id: 'c1' };
      mockCreateTeamConnection.mockResolvedValueOnce(conn);

      const res = await makeRequest(app, 'POST', '/connections/team', {
        integrationId: 'linear',
        credentials: { api_key: 'xxx' },
        label: 'Main',
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(conn);
    });

    it('returns 400 when missing fields', async () => {
      const res = await makeRequest(app, 'POST', '/connections/team', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'integrationId and credentials are required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(connectionRoutes, '/connections', 'member');

      const res = await makeRequest(memberApp, 'POST', '/connections/team', {
        integrationId: 'x',
        credentials: {},
      });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /connections/personal', () => {
    it('creates personal connection', async () => {
      const conn = { id: 'c2' };
      mockCreatePersonalConnection.mockResolvedValueOnce(conn);

      const res = await makeRequest(app, 'POST', '/connections/personal', {
        integrationId: 'github',
        credentials: { token: 'xxx' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(conn);
    });

    it('returns 400 when missing fields', async () => {
      const res = await makeRequest(app, 'POST', '/connections/personal', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'integrationId and credentials are required' });
    });
  });

  describe('DELETE /connections/:id', () => {
    it('deletes connection', async () => {
      mockDeleteConnection.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/connections/c1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 400 on error', async () => {
      mockDeleteConnection.mockRejectedValueOnce(new Error('Not found'));

      const res = await makeRequest(app, 'DELETE', '/connections/bad');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't delete the connection. Please try again." });
    });
  });

  describe('GET /connections/agent-tool-usage', () => {
    it('returns tool-agent usage map (admin)', async () => {
      const usage = { linear: ['a1', 'a2'] };
      mockGetToolAgentUsage.mockResolvedValueOnce(usage);

      const res = await makeRequest(app, 'GET', '/connections/agent-tool-usage');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(usage);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(connectionRoutes, '/connections', 'member');

      const res = await makeRequest(memberApp, 'GET', '/connections/agent-tool-usage');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /connections/agent/:agentId', () => {
    it('returns agent tool connections', async () => {
      const conns = [{ agent_id: 'a1', tool_name: 'linear', connection_mode: 'team', connection_id: null }];
      mockListAgentToolConnections.mockResolvedValueOnce(conns);

      const res = await makeRequest(app, 'GET', '/connections/agent/a1');

      expect(res.status).toBe(200);
      expect(res.body[0].toolName).toBe('linear');
      expect(res.body[0].mode).toBe('team');
    });
  });

  describe('PUT /connections/agent/:agentId/:toolName', () => {
    it('sets agent tool connection for all tools in integration', async () => {
      const result = { ok: true };
      mockSetAgentToolConnection.mockResolvedValue(result);
      // getAgent returns agent with both -read and -write tools
      mockGetAgent.mockResolvedValueOnce({ tools: ['linear-read', 'linear-write'] });

      const res = await makeRequest(app, 'PUT', '/connections/agent/a1/linear-read', {
        mode: 'team',
        connectionId: 'c1',
      });

      expect(res.status).toBe(200);
      // Should set for the requested tool AND the sibling
      expect(mockSetAgentToolConnection).toHaveBeenCalledTimes(2);
      expect(mockSetAgentToolConnection).toHaveBeenCalledWith('W123', 'a1', 'linear-read', 'team', 'c1', 'U123');
      expect(mockSetAgentToolConnection).toHaveBeenCalledWith('W123', 'a1', 'linear-write', 'team', 'c1', 'U123');
    });

    it('returns 400 when mode is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/connections/agent/a1/linear', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'mode is required' });
    });
  });
});

// ────────────────────────────────────────────────
// Triggers
// ────────────────────────────────────────────────

describe('Trigger Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(triggerRoutes, '/triggers');
  });

  describe('GET /triggers', () => {
    it('lists all triggers with JOIN query when no type filter', async () => {
      const rows = [
        {
          id: 't1', agent_id: 'a1', agent_name: 'Bot1', agent_avatar: '',
          trigger_type: 'webhook', config_json: '{}', status: 'active',
          last_triggered_at: null, last_fired_at: null, created_at: '2025-01-01',
        },
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const res = await makeRequest(app, 'GET', '/triggers');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{
        id: 't1', agentId: 'a1', agentName: 'Bot1', agentAvatar: '',
        type: 'webhook', config: {}, enabled: true,
        lastTriggeredAt: null, createdAt: '2025-01-01',
      }]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('LEFT JOIN agents');
    });

    it('filters by type when provided', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await makeRequest(app, 'GET', '/triggers?type=webhook');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('trigger_type = $2');
      expect(mockQuery.mock.calls[0][1]).toEqual(['W123', 'webhook']);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/triggers');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list triggers' });
    });

    it('maps disabled triggers correctly', async () => {
      const rows = [
        {
          id: 't2', agent_id: 'a2', agent_name: null, agent_avatar: null,
          trigger_type: 'schedule', config_json: '{"cron":"0 9 * * 1-5"}', status: 'paused',
          last_triggered_at: null, last_fired_at: '2025-06-01T12:00:00Z', created_at: '2025-01-01',
        },
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const res = await makeRequest(app, 'GET', '/triggers');

      expect(res.status).toBe(200);
      expect(res.body[0].enabled).toBe(false);
      expect(res.body[0].agentName).toBe('Unknown');
      expect(res.body[0].config).toEqual({ cron: '0 9 * * 1-5' });
      expect(res.body[0].lastTriggeredAt).toBe('2025-06-01T12:00:00Z');
    });
  });

  describe('GET /triggers/:id', () => {
    it('returns trigger by id', async () => {
      const trigger = { id: 't1', type: 'webhook' };
      mockGetTrigger.mockResolvedValueOnce(trigger);

      const res = await makeRequest(app, 'GET', '/triggers/t1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(trigger);
    });

    it('returns 404 when not found', async () => {
      mockGetTrigger.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/triggers/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Trigger not found' });
    });
  });

  describe('POST /triggers', () => {
    it('creates trigger', async () => {
      const trigger = { id: 't1', type: 'webhook' };
      mockCreateTrigger.mockResolvedValueOnce(trigger);

      const res = await makeRequest(app, 'POST', '/triggers', {
        agentId: 'a1',
        triggerType: 'webhook',
        config: { url: '/test' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(trigger);
    });

    it('creates trigger with type field (frontend compat)', async () => {
      const trigger = { id: 't1', type: 'schedule' };
      mockCreateTrigger.mockResolvedValueOnce(trigger);

      const res = await makeRequest(app, 'POST', '/triggers', {
        agentId: 'a1',
        type: 'schedule',
        config: { cron: '0 9 * * 1-5' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(trigger);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await makeRequest(app, 'POST', '/triggers', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'agentId and triggerType are required' });
    });

    it('returns 400 on error', async () => {
      mockCreateTrigger.mockRejectedValueOnce(new Error('Invalid type'));

      const res = await makeRequest(app, 'POST', '/triggers', {
        agentId: 'a1',
        triggerType: 'bad',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't create the trigger. Please try again." });
    });
  });

  describe('PATCH /triggers/:id', () => {
    it('enables trigger', async () => {
      mockResumeTrigger.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PATCH', '/triggers/t1', { enabled: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockResumeTrigger).toHaveBeenCalledWith('W123', 't1', 'U123');
    });

    it('disables trigger', async () => {
      mockPauseTrigger.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PATCH', '/triggers/t1', { enabled: false });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockPauseTrigger).toHaveBeenCalledWith('W123', 't1', 'U123');
    });

    it('returns 400 on error', async () => {
      mockResumeTrigger.mockRejectedValueOnce(new Error('Not found'));

      const res = await makeRequest(app, 'PATCH', '/triggers/t1', { enabled: true });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't update the trigger. Please try again." });
    });
  });

  describe('POST /triggers/:id/pause', () => {
    it('pauses trigger', async () => {
      mockPauseTrigger.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/triggers/t1/pause');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 400 on error', async () => {
      mockPauseTrigger.mockRejectedValueOnce(new Error('Already paused'));

      const res = await makeRequest(app, 'POST', '/triggers/t1/pause');

      expect(res.status).toBe(400);
    });
  });

  describe('POST /triggers/:id/resume', () => {
    it('resumes trigger', async () => {
      mockResumeTrigger.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/triggers/t1/resume');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });

  describe('DELETE /triggers/:id', () => {
    it('deletes trigger', async () => {
      mockDeleteTrigger.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'DELETE', '/triggers/t1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});

// ────────────────────────────────────────────────
// Workflows
// ────────────────────────────────────────────────

describe('Workflow Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(workflowRoutes, '/workflows');
  });

  describe('GET /workflows/definitions', () => {
    it('lists workflow definitions', async () => {
      const defs = [{ id: 'wd1', name: 'Onboard' }];
      mockQuery.mockResolvedValueOnce(defs);

      const res = await makeRequest(app, 'GET', '/workflows/definitions');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(defs);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/workflows/definitions');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list workflow definitions' });
    });
  });

  describe('GET /workflows/definitions/:id', () => {
    it('returns workflow definition', async () => {
      const def = { id: 'wd1', name: 'Onboard' };
      mockGetWorkflowDefinition.mockResolvedValueOnce(def);

      const res = await makeRequest(app, 'GET', '/workflows/definitions/wd1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(def);
    });

    it('returns 404 when not found', async () => {
      mockGetWorkflowDefinition.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/workflows/definitions/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Workflow definition not found' });
    });
  });

  describe('POST /workflows/definitions', () => {
    it('creates workflow definition', async () => {
      const def = { id: 'wd1', name: 'Test' };
      mockCreateWorkflowDefinition.mockResolvedValueOnce(def);

      const res = await makeRequest(app, 'POST', '/workflows/definitions', {
        name: 'Test',
        agentId: 'a1',
        steps: [{ type: 'agent' }],
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(def);
    });

    it('returns 400 when required fields missing', async () => {
      const res = await makeRequest(app, 'POST', '/workflows/definitions', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'name, agentId, and steps are required' });
    });
  });

  describe('GET /workflows/runs', () => {
    it('lists workflow runs', async () => {
      const runs = [{ id: 'wr1' }];
      mockQuery.mockResolvedValueOnce(runs);

      const res = await makeRequest(app, 'GET', '/workflows/runs');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(runs);
    });
  });

  describe('GET /workflows/runs/:id', () => {
    it('returns workflow run', async () => {
      const run = { id: 'wr1', status: 'running' };
      mockGetWorkflowRun.mockResolvedValueOnce(run);

      const res = await makeRequest(app, 'GET', '/workflows/runs/wr1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(run);
    });

    it('returns 404 when not found', async () => {
      mockGetWorkflowRun.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/workflows/runs/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Workflow run not found' });
    });
  });

  describe('POST /workflows/definitions/:id/start', () => {
    it('starts a workflow', async () => {
      const run = { id: 'wr1' };
      mockStartWorkflow.mockResolvedValueOnce(run);

      const res = await makeRequest(app, 'POST', '/workflows/definitions/wd1/start');

      expect(res.status).toBe(201);
      expect(res.body).toEqual(run);
    });

    it('returns 400 on error', async () => {
      mockStartWorkflow.mockRejectedValueOnce(new Error('Not found'));

      const res = await makeRequest(app, 'POST', '/workflows/definitions/bad/start');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't start the workflow. Please try again." });
    });
  });

  describe('POST /workflows/runs/:id/resolve', () => {
    it('resolves human action', async () => {
      mockResolveHumanAction.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/workflows/runs/wr1/resolve', {
        actionData: { approved: true },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('returns 400 when actionData is missing', async () => {
      const res = await makeRequest(app, 'POST', '/workflows/runs/wr1/resolve', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'actionData is required' });
    });
  });
});

// ────────────────────────────────────────────────
// Evolution
// ────────────────────────────────────────────────

describe('Evolution Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(evolutionRoutes, '/evolution');
  });

  describe('GET /evolution/proposals', () => {
    it('lists pending proposals with agent info', async () => {
      const proposals = [{ id: 'p1', agent_id: 'a1', action: 'update_prompt', description: 'Refine prompt', diff: '{}', status: 'pending', created_at: '2026-01-01T00:00:00Z', resolved_at: null }];
      mockGetPendingProposals.mockResolvedValueOnce(proposals);
      // Agent lookup
      mockQuery.mockResolvedValueOnce([{ id: 'a1', name: 'TestBot', avatar_emoji: ':robot_face:' }]);

      const res = await makeRequest(app, 'GET', '/evolution/proposals');

      expect(res.status).toBe(200);
      expect(res.body.proposals).toHaveLength(1);
      expect(res.body.proposals[0].agentName).toBe('TestBot');
      expect(res.body.proposals[0].agentAvatar).toBe(':robot_face:');
      expect(res.body.proposals[0].action).toBe('update_prompt');
      expect(res.body.total).toBe(1);
    });

    it('filters by agentId', async () => {
      mockGetPendingProposals.mockResolvedValueOnce([]);
      // No agents to look up when empty

      await makeRequest(app, 'GET', '/evolution/proposals?agentId=a1&status=pending');

      expect(mockGetPendingProposals).toHaveBeenCalledWith('W123', 'a1');
    });

    it('queries directly for non-pending status filters', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'p2', agent_id: 'a1', action: 'write_tool', description: 'Write tool', diff: '{}', status: 'approved', created_at: '2026-01-01T00:00:00Z', resolved_at: '2026-01-01T01:00:00Z' }])
        .mockResolvedValueOnce([{ id: 'a1', name: 'Bot', avatar_emoji: ':star:' }]);

      const res = await makeRequest(app, 'GET', '/evolution/proposals?status=approved&agentId=a1');

      expect(res.status).toBe(200);
      expect(res.body.proposals[0].status).toBe('approved');
      expect(res.body.total).toBe(1);
    });

    it('returns 500 on error', async () => {
      mockGetPendingProposals.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/evolution/proposals');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list proposals' });
    });
  });

  describe('GET /evolution/proposals/history/:agentId', () => {
    it('returns proposal history', async () => {
      const history = [{ id: 'p1', status: 'approved' }];
      mockGetProposalHistory.mockResolvedValueOnce(history);

      const res = await makeRequest(app, 'GET', '/evolution/proposals/history/a1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(history);
    });
  });

  describe('POST /evolution/proposals/:id/approve', () => {
    it('approves proposal', async () => {
      const result = { ok: true };
      mockApproveProposal.mockResolvedValueOnce(result);

      const res = await makeRequest(app, 'POST', '/evolution/proposals/p1/approve');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(result);
      expect(mockApproveProposal).toHaveBeenCalledWith('W123', 'p1', 'U123');
    });

    it('returns 400 on error', async () => {
      mockApproveProposal.mockRejectedValueOnce(new Error('Not found'));

      const res = await makeRequest(app, 'POST', '/evolution/proposals/bad/approve');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't approve the proposal. Please try again." });
    });
  });

  describe('POST /evolution/proposals/:id/reject', () => {
    it('rejects proposal', async () => {
      mockRejectProposal.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'POST', '/evolution/proposals/p1/reject');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });
  });
});

// ────────────────────────────────────────────────
// Audit
// ────────────────────────────────────────────────

describe('Audit Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(auditRoutes, '/audit');
  });

  describe('GET /audit', () => {
    it('lists audit entries (admin only)', async () => {
      const entries = [{ id: 'al1', action: 'create_agent' }];
      mockGetAuditLog.mockResolvedValueOnce(entries);

      const res = await makeRequest(app, 'GET', '/audit');

      expect(res.status).toBe(200);
      expect(res.body.entries).toBeDefined();
      expect(res.body.total).toBeDefined();
      expect(mockGetAuditLog).toHaveBeenCalledWith('W123', {
        limit: 20,
        offset: 0,
      });
    });

    it('passes filter parameters', async () => {
      mockGetAuditLog.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/audit?agentId=a1&userId=U1&actionType=create&page=2&limit=10');

      expect(mockGetAuditLog).toHaveBeenCalledWith('W123', {
        agentId: 'a1',
        userId: 'U1',
        actionType: 'create',
        limit: 10,
        offset: 10,
      });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(auditRoutes, '/audit', 'member');

      const res = await makeRequest(memberApp, 'GET', '/audit');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockGetAuditLog.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/audit');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get audit log' });
    });
  });
});

// ────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────

describe('Settings Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(settingsRoutes, '/settings');
  });

  describe('GET /settings', () => {
    it('returns settings as key-value map (admin)', async () => {
      mockGetAllSettings.mockResolvedValueOnce([
        { key: 'daily_budget', value: '10' },
        { key: 'max_agents', value: '5' },
      ]);

      const res = await makeRequest(app, 'GET', '/settings');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ daily_budget: '10', max_agents: '5' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(settingsRoutes, '/settings', 'member');

      const res = await makeRequest(memberApp, 'GET', '/settings');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockGetAllSettings.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/settings');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get settings' });
    });
  });

  describe('PUT /settings/:key', () => {
    it('sets a workspace setting (admin)', async () => {
      mockSetSetting.mockResolvedValueOnce(undefined);

      const res = await makeRequest(app, 'PUT', '/settings/daily_budget', {
        value: '20',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockSetSetting).toHaveBeenCalledWith('W123', 'daily_budget', '20', 'U123');
    });

    it('returns 400 when value is missing', async () => {
      const res = await makeRequest(app, 'PUT', '/settings/daily_budget', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'value is required' });
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(settingsRoutes, '/settings', 'member');

      const res = await makeRequest(memberApp, 'PUT', '/settings/daily_budget', {
        value: '20',
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 on error', async () => {
      mockSetSetting.mockRejectedValueOnce(new Error('Invalid key'));

      const res = await makeRequest(app, 'PUT', '/settings/bad_key', {
        value: 'x',
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "Couldn't update the setting. Please try again." });
    });
  });
});

// ────────────────────────────────────────────────
// Slack Helpers
// ────────────────────────────────────────────────

describe('Slack Helper Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(slackHelperRoutes, '/slack');
  });

  describe('GET /slack/channels', () => {
    it('lists Slack channels', async () => {
      const mockClient = {
        conversations: {
          list: vi.fn().mockResolvedValueOnce({
            channels: [
              {
                id: 'C1',
                name: 'general',
                is_private: false,
                is_member: true,
                num_members: 10,
                topic: { value: 'General chat' },
                purpose: { value: 'Main channel' },
              },
            ],
            response_metadata: { next_cursor: '' },
          }),
        },
      };
      mockGetSlackApp.mockReturnValueOnce({ client: mockClient });

      const res = await makeRequest(app, 'GET', '/slack/channels');

      expect(res.status).toBe(200);
      expect(res.body.channels).toEqual([
        {
          id: 'C1',
          name: 'general',
          isPrivate: false,
          isMember: true,
          numMembers: 10,
          topic: 'General chat',
          purpose: 'Main channel',
        },
      ]);
    });

    it('returns 500 on error', async () => {
      mockGetSlackApp.mockReturnValueOnce({
        client: {
          conversations: {
            list: vi.fn().mockRejectedValueOnce(new Error('API error')),
          },
        },
      });

      const res = await makeRequest(app, 'GET', '/slack/channels');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list channels' });
    });
  });

  describe('GET /slack/users', () => {
    it('lists Slack users (filters bots and deleted)', async () => {
      const mockClient = {
        users: {
          list: vi.fn()
            .mockResolvedValueOnce({
              members: [
                {
                  id: 'U1',
                  name: 'alice',
                  real_name: 'Alice',
                  is_bot: false,
                  deleted: false,
                  is_admin: true,
                  is_owner: false,
                  profile: { display_name: 'Alice D', image_72: 'https://img.com/a.png', real_name: 'Alice R' },
                },
                { id: 'U2', name: 'bot', is_bot: true, deleted: false, profile: {} },
                { id: 'U3', name: 'gone', is_bot: false, deleted: true, profile: {} },
                { id: 'USLACKBOT', name: 'slackbot', is_bot: false, deleted: false, profile: {} },
              ],
              response_metadata: { next_cursor: 'abc' },
            })
            .mockResolvedValueOnce({
              members: [
                { id: 'U4', name: 'bob', real_name: 'Bob', is_bot: false, deleted: false, is_admin: false, is_owner: false, profile: { display_name: 'Bob B', image_72: '' } },
              ],
              response_metadata: { next_cursor: '' },
            }),
        },
      };
      mockGetSlackApp.mockReturnValueOnce({ client: mockClient });

      const res = await makeRequest(app, 'GET', '/slack/users');

      expect(res.status).toBe(200);
      expect(res.body.users).toHaveLength(2); // Alice from page 1 + Bob from page 2
      expect(res.body.users[0]).toEqual({
        id: 'U1',
        name: 'alice',
        realName: 'Alice',
        displayName: 'Alice D',
        avatarUrl: 'https://img.com/a.png',
        isAdmin: true,
        isOwner: false,
      });
      expect(res.body.nextCursor).toBeNull();
    });

    it('returns 500 on error', async () => {
      mockGetSlackApp.mockReturnValueOnce({
        client: {
          users: {
            list: vi.fn().mockRejectedValueOnce(new Error('API error')),
          },
        },
      });

      const res = await makeRequest(app, 'GET', '/slack/users');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to list users' });
    });
  });
});

// ────────────────────────────────────────────────
// Observability
// ────────────────────────────────────────────────

describe('Observability Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveUserNames.mockImplementation(async (ids: string[]) => {
      const result: Record<string, string> = {};
      for (const id of ids) result[id] = id;
      return result;
    });
    app = createApp(observabilityRoutes, '/observability');
  });

  describe('GET /observability/alert-rules', () => {
    it('returns alert rules', async () => {
      const rules = [{ name: 'high_error_rate' }];
      mockGetAlertRules.mockReturnValueOnce(rules);

      const res = await makeRequest(app, 'GET', '/observability/alert-rules');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(rules);
    });

    it('returns 500 on error', async () => {
      mockGetAlertRules.mockImplementationOnce(() => { throw new Error('err'); });

      const res = await makeRequest(app, 'GET', '/observability/alert-rules');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /observability/alerts', () => {
    it('returns current alerts (admin)', async () => {
      const alerts = [{ rule: 'high_error_rate', triggered: true }];
      mockCheckAlerts.mockResolvedValueOnce(alerts);

      const res = await makeRequest(app, 'GET', '/observability/alerts');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(alerts);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(observabilityRoutes, '/observability', 'member');

      const res = await makeRequest(memberApp, 'GET', '/observability/alerts');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /observability/error-rates', () => {
    it('returns error rates (admin)', async () => {
      const rates = [{ agentId: 'a1', errorRate: 0.05 }];
      mockGetAgentErrorRates.mockResolvedValueOnce(rates);

      const res = await makeRequest(app, 'GET', '/observability/error-rates');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(rates);
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(observabilityRoutes, '/observability', 'member');

      const res = await makeRequest(memberApp, 'GET', '/observability/error-rates');

      expect(res.status).toBe(403);
    });
  });

  describe('GET /observability/error-log', () => {
    it('returns failed runs with resolved display names (admin)', async () => {
      const rows = [
        { id: 'r1', agent_id: 'a1', agent_name: 'Bot1', avatar_emoji: '\uD83E\uDD16', slack_user_id: 'U1', status: 'failed', output: 'Error occurred' },
      ];
      mockQuery.mockResolvedValueOnce(rows);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice' });

      const res = await makeRequest(app, 'GET', '/observability/error-log');

      expect(res.status).toBe(200);
      expect(res.body[0].agentName).toBe('Bot1');
      expect(res.body[0].displayName).toBe('Alice');
      expect(res.body[0].avatarEmoji).toBe('\uD83E\uDD16');
      expect(res.body[0].slackUserId).toBe('U1');
    });

    it('uses default params', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/observability/error-log');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("status = 'failed'");
    });

    it('filters by agentId', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/observability/error-log?agentId=a1');

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('r.agent_id = $3');
      expect(mockQuery.mock.calls[0][1]).toContain('a1');
    });

    it('returns 403 for non-admin', async () => {
      const memberApp = createApp(observabilityRoutes, '/observability', 'member');

      const res = await makeRequest(memberApp, 'GET', '/observability/error-log');

      expect(res.status).toBe(403);
    });

    it('returns 500 on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/observability/error-log');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get error log' });
    });
  });
});

// ────────────────────────────────────────────────
// Skills
// ────────────────────────────────────────────────

describe('Skill Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(skillRoutes, '/skills');
  });

  describe('GET /skills/builtin', () => {
    it('returns available builtin skills', async () => {
      const skills = [{ id: 's1', name: 'Analysis' }];
      mockGetAvailableSkills.mockReturnValueOnce(skills);

      const res = await makeRequest(app, 'GET', '/skills/builtin');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(skills);
    });

    it('returns 500 on error', async () => {
      mockGetAvailableSkills.mockImplementationOnce(() => { throw new Error('err'); });

      const res = await makeRequest(app, 'GET', '/skills/builtin');

      expect(res.status).toBe(500);
    });
  });

  describe('GET /skills', () => {
    it('lists registered skills', async () => {
      const skills = [{ id: 's1', name: 'Skill1' }];
      mockListSkills.mockResolvedValueOnce(skills);

      const res = await makeRequest(app, 'GET', '/skills');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(skills);
    });

    it('filters by type', async () => {
      mockListSkills.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/skills?type=mcp');

      expect(mockListSkills).toHaveBeenCalledWith('W123', 'mcp');
    });

    it('returns 500 on error', async () => {
      mockListSkills.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/skills');

      expect(res.status).toBe(500);
    });
  });
});

// ────────────────────────────────────────────────
// Runs
// ────────────────────────────────────────────────

describe('Run Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveUserNames.mockImplementation(async (ids: string[]) => {
      const result: Record<string, string> = {};
      for (const id of ids) result[id] = id;
      return result;
    });
    app = createApp(runRoutes, '/runs');
  });

  describe('GET /runs', () => {
    it('lists recent runs with resolved display names', async () => {
      const runs = [{ id: 'r1', slack_user_id: 'U1' }];
      mockGetRecentRuns.mockResolvedValueOnce(runs);
      mockResolveUserNames.mockResolvedValueOnce({ U1: 'Alice' });

      const res = await makeRequest(app, 'GET', '/runs');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 'r1', slack_user_id: 'U1', displayName: 'Alice' }]);
      expect(mockGetRecentRuns).toHaveBeenCalledWith('W123', 20);
    });

    it('uses custom limit', async () => {
      mockGetRecentRuns.mockResolvedValueOnce([]);

      await makeRequest(app, 'GET', '/runs?limit=5');

      expect(mockGetRecentRuns).toHaveBeenCalledWith('W123', 5);
    });
  });

  describe('GET /runs/trace/:traceId', () => {
    it('finds run by trace ID', async () => {
      const run = { id: 'r1', trace_id: 'tr-123' };
      mockQueryOne.mockResolvedValueOnce(run);

      const res = await makeRequest(app, 'GET', '/runs/trace/tr-123');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(run);
    });

    it('returns 404 when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/runs/trace/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Run not found' });
    });
  });

  describe('GET /runs/:id', () => {
    it('returns run detail', async () => {
      const run = { id: 'r1', status: 'completed' };
      mockGetRunRecord.mockResolvedValueOnce(run);

      const res = await makeRequest(app, 'GET', '/runs/r1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual(run);
    });

    it('returns 404 when not found', async () => {
      mockGetRunRecord.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'GET', '/runs/missing');

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Run not found' });
    });

    it('returns 500 on error', async () => {
      mockGetRunRecord.mockRejectedValueOnce(new Error('DB error'));

      const res = await makeRequest(app, 'GET', '/runs/r1');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to get run' });
    });
  });
});
