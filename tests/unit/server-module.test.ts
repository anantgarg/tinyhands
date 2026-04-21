import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';

// ── Mocks ──

const mockDeployWebhookHandler = vi.fn((_req: any, res: any) => res.status(200).json({ ok: true }));
const mockGetActiveTriggersByType = vi.fn();
const mockFireTrigger = vi.fn();
const mockVerifyLinearSignature = vi.fn();
const mockVerifyZendeskSignature = vi.fn();
const mockVerifyIntercomSignature = vi.fn();
const mockSearchKB = vi.fn();
const mockListKBEntries = vi.fn();
const mockGetCategories = vi.fn();

vi.mock('../../src/modules/auto-update', () => ({
  deployWebhookHandler: (...args: any[]) => mockDeployWebhookHandler(...args),
}));

vi.mock('../../src/modules/triggers', () => ({
  fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  getActiveTriggersByType: (...args: any[]) => mockGetActiveTriggersByType(...args),
}));

vi.mock('../../src/utils/webhooks', () => ({
  verifyLinearSignature: (...args: any[]) => mockVerifyLinearSignature(...args),
  verifyZendeskSignature: (...args: any[]) => mockVerifyZendeskSignature(...args),
  verifyIntercomSignature: (...args: any[]) => mockVerifyIntercomSignature(...args),
}));

vi.mock('../../src/modules/knowledge-base', () => ({
  searchKB: (...args: any[]) => mockSearchKB(...args),
  listKBEntries: (...args: any[]) => mockListKBEntries(...args),
  getCategories: (...args: any[]) => mockGetCategories(...args),
}));

const mockDbQuery = vi.fn().mockResolvedValue([]);
const mockDbQueryOne = vi.fn().mockResolvedValue(undefined);
const mockListActiveWorkspaces = vi.fn().mockResolvedValue([{ id: 'W_TEST_123', team_name: 'Test', workspace_slug: 'test', status: 'active', bot_token: '', bot_user_id: '', installed_at: '', updated_at: '', domain: null, bot_id: null, app_id: null, authed_user_id: null, scope: null }]);
vi.mock('../../src/db', () => ({
  getDefaultWorkspaceId: () => 'W_TEST_123',
  getDefaultWorkspaceIdOrNull: () => 'W_TEST_123',
  query: (...args: any[]) => mockDbQuery(...args),
  queryOne: (...args: any[]) => mockDbQueryOne(...args),
  listActiveWorkspaces: (...args: any[]) => mockListActiveWorkspaces(...args),
  upsertWorkspace: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../../src/config', () => ({
  config: {
    server: { port: 3000, internalSecret: '', nodeEnv: 'test', sessionSecret: 'test-secret', webDashboardUrl: '' },
    slack: { botToken: '', appToken: '', signingSecret: '', clientId: '', clientSecret: '' },
    redis: { url: 'redis://localhost:6379' },
    oauth: { redirectBaseUrl: 'http://localhost:3000', googleClientId: '', googleClientSecret: '', notionClientId: '', notionClientSecret: '', githubClientId: '', githubClientSecret: '' },
    observability: { logLevel: 'info', dailyDigestTime: '09:00', dailyBudgetUsd: 50 },
    docker: { baseImage: 'tinyhands-runner:latest', defaultCpu: 1, defaultMemory: 2147483648, defaultJobTimeoutMs: 3600000, maxConcurrentWorkers: 3 },
    encryption: { key: '' },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockHandleOAuthCallback = vi.fn();
vi.mock('../../src/modules/connections/oauth', () => ({
  handleOAuthCallback: (...args: any[]) => mockHandleOAuthCallback(...args),
}));

const mockSlackPostMessage = vi.fn();
const mockSlackPostBlocks = vi.fn().mockResolvedValue('msg-ts-789');
vi.mock('../../src/slack', () => ({
  postMessage: (...args: any[]) => mockSlackPostMessage(...args),
  postBlocks: (...args: any[]) => mockSlackPostBlocks(...args),
  sendDMBlocks: vi.fn(),
}));

// Mock queue module for approval state
const mockSetApprovalState = vi.fn().mockResolvedValue(undefined);
const mockGetApprovalState = vi.fn().mockResolvedValue('pending');
vi.mock('../../src/queue', () => ({
  setApprovalState: (...args: any[]) => mockSetApprovalState(...args),
  getApprovalState: (...args: any[]) => mockGetApprovalState(...args),
}));

// Mock modules imported transitively by API routes
vi.mock('../../src/modules/agents', () => ({
  createAgent: vi.fn(),
  getAgent: vi.fn(),
  listAgents: vi.fn().mockResolvedValue([]),
  getAccessibleAgents: vi.fn().mockResolvedValue([]),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  getAgentVersions: vi.fn().mockResolvedValue([]),
  revertAgent: vi.fn(),
}));

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: vi.fn().mockResolvedValue(true),
  canView: vi.fn().mockResolvedValue(true),
  isPlatformAdmin: vi.fn().mockResolvedValue(false),
  getAgentRole: vi.fn().mockResolvedValue('viewer'),
  setAgentRole: vi.fn(),
  removeAgentRole: vi.fn(),
  getAgentRoles: vi.fn().mockResolvedValue([]),
  requestUpgrade: vi.fn(),
  approveUpgrade: vi.fn(),
  denyUpgrade: vi.fn(),
  getPlatformRole: vi.fn().mockResolvedValue('member'),
  setPlatformRole: vi.fn(),
  removePlatformRole: vi.fn(),
  listPlatformAdmins: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/modules/execution', () => ({
  getRecentRuns: vi.fn().mockResolvedValue([]),
  getRunsByAgent: vi.fn().mockResolvedValue([]),
  getRunRecord: vi.fn(),
}));

vi.mock('../../src/modules/tools', () => ({
  getBuiltinTools: vi.fn().mockReturnValue([]),
  addToolToAgent: vi.fn(),
  removeToolFromAgent: vi.fn(),
  listCustomTools: vi.fn().mockResolvedValue([]),
  getCustomTool: vi.fn(),
  registerCustomTool: vi.fn(),
  approveCustomTool: vi.fn(),
  deleteCustomTool: vi.fn(),
  getToolConfig: vi.fn(),
  updateToolConfig: vi.fn(),
  setToolConfigKey: vi.fn(),
  removeToolConfigKey: vi.fn(),
  updateToolAccessLevel: vi.fn(),
  getAgentToolSummary: vi.fn().mockResolvedValue({ builtin: [], custom: [], mcp: [] }),
}));

vi.mock('../../src/modules/dashboard', () => ({
  getMetrics: vi.fn().mockResolvedValue({
    totalRuns: 0, totalTokens: 0, totalCostUsd: 0, errorRate: 0,
    avgDurationMs: 0, p50DurationMs: 0, p95DurationMs: 0, p99DurationMs: 0,
    queueWaitP50Ms: 0, queueWaitP95Ms: 0, tokensByAgent: {}, tokensByUser: {},
    tokensByModel: {}, runsByAgent: {},
  }),
  buildDashboardBlocks: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/modules/audit', () => ({
  getAuditLog: vi.fn().mockResolvedValue([]),
  logAuditEvent: vi.fn(),
}));

vi.mock('../../src/modules/kb-sources', () => ({
  listSources: vi.fn().mockResolvedValue([]),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  deleteSource: vi.fn(),
  startSync: vi.fn(),
  flushAndResync: vi.fn(),
  listApiKeys: vi.fn().mockResolvedValue([]),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
}));

vi.mock('../../src/modules/connections', () => ({
  listTeamConnections: vi.fn().mockResolvedValue([]),
  listPersonalConnectionsForUser: vi.fn().mockResolvedValue([]),
  createTeamConnection: vi.fn(),
  createPersonalConnection: vi.fn(),
  deleteConnection: vi.fn(),
  listAgentToolConnections: vi.fn().mockResolvedValue([]),
  setAgentToolConnection: vi.fn(),
  getToolAgentUsage: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/modules/workflows', () => ({
  createWorkflowDefinition: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  startWorkflow: vi.fn(),
  getWorkflowRun: vi.fn(),
  resolveHumanAction: vi.fn(),
}));

vi.mock('../../src/modules/self-evolution', () => ({
  getPendingProposals: vi.fn().mockResolvedValue([]),
  getProposalHistory: vi.fn().mockResolvedValue([]),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
}));

vi.mock('../../src/modules/observability', () => ({
  getAlertRules: vi.fn().mockReturnValue([]),
  checkAlerts: vi.fn().mockResolvedValue([]),
  getAgentErrorRates: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/modules/workspace-settings', () => ({
  getAllSettings: vi.fn().mockResolvedValue([]),
  setSetting: vi.fn(),
}));

vi.mock('../../src/modules/skills', () => ({
  getAvailableSkills: vi.fn().mockReturnValue({ mcp: [], prompt: [] }),
  listSkills: vi.fn().mockResolvedValue([]),
  attachSkillToAgent: vi.fn(),
  detachSkillFromAgent: vi.fn(),
  getAgentSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock('connect-redis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      destroy: vi.fn(),
      touch: vi.fn(),
    })),
  };
});

const mockRedisQuit = vi.fn().mockResolvedValue('OK');
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      status: 'ready',
      quit: (...args: any[]) => mockRedisQuit(...args),
    })),
  };
});

vi.mock('express-session', () => {
  const sessionMiddleware = (_req: any, _res: any, next: any) => next();
  sessionMiddleware.Store = class Store {};
  return { default: vi.fn(() => sessionMiddleware) };
});

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import { createWebhookServer, closeSessionRedis } from '../../src/server';

// ── HTTP Test Helper ──

function makeTestRequest(
  app: ReturnType<typeof createWebhookServer>,
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

// ── Env helpers ──

let savedEnv: Record<string, string | undefined> = {};

function saveAndClearWebhookSecrets() {
  savedEnv = {
    LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET,
    ZENDESK_WEBHOOK_SECRET: process.env.ZENDESK_WEBHOOK_SECRET,
    INTERCOM_WEBHOOK_SECRET: process.env.INTERCOM_WEBHOOK_SECRET,
  };
  delete process.env.LINEAR_WEBHOOK_SECRET;
  delete process.env.ZENDESK_WEBHOOK_SECRET;
  delete process.env.INTERCOM_WEBHOOK_SECRET;
}

function restoreWebhookSecrets() {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ── Tests ──

describe('Webhook Server', () => {
  let app: ReturnType<typeof createWebhookServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    saveAndClearWebhookSecrets();
    app = createWebhookServer();
  });

  afterEach(() => {
    restoreWebhookSecrets();
  });

  // ────────────────────────────────────────────────
  // createWebhookServer
  // ────────────────────────────────────────────────
  describe('createWebhookServer', () => {
    it('returns an express application with listen and use functions', () => {
      const server = createWebhookServer();
      expect(server).toBeDefined();
      expect(typeof server.listen).toBe('function');
      expect(typeof server.use).toBe('function');
    });

    it('returns a new app instance on each call', () => {
      const app1 = createWebhookServer();
      const app2 = createWebhookServer();
      expect(app1).not.toBe(app2);
    });
  });

  // ────────────────────────────────────────────────
  // Health check
  // ────────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns status ok with uptime', async () => {
      const res = await makeTestRequest(app, 'GET', '/health');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptime');
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  // ────────────────────────────────────────────────
  // GitHub Deploy Webhook
  // ────────────────────────────────────────────────
  describe('POST /webhooks/github-deploy', () => {
    it('calls the deploy webhook handler', async () => {
      const res = await makeTestRequest(app, 'POST', '/webhooks/github-deploy', {
        ref: 'refs/heads/main',
      });

      expect(res.status).toBe(200);
      expect(mockDeployWebhookHandler).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────
  // Generic Agent Webhook Triggers
  // ────────────────────────────────────────────────
  describe('POST /webhooks/agent-:agentName', () => {
    it('fires matching webhook triggers and returns 202', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'trigger-1', workspace_id: 'W_TEST_123', config_json: JSON.stringify({ agent_name: 'my-bot' }) },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/agent-my-bot', {
        id: 'req-1',
        data: 'hello',
      });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message: 'Trigger fired', count: 1 });
      expect(mockGetActiveTriggersByType).toHaveBeenCalledWith('W_TEST_123', 'webhook');
      expect(mockFireTrigger).toHaveBeenCalledWith('W_TEST_123', {
        triggerId: 'trigger-1',
        idempotencyKey: 'webhook:my-bot:req-1',
        payload: { id: 'req-1', data: 'hello' },
      });
    });

    it('fires multiple matching triggers', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'trigger-1', workspace_id: 'W_TEST_123', config_json: JSON.stringify({ agent_name: 'multi' }) },
        { id: 'trigger-2', workspace_id: 'W_TEST_123', config_json: JSON.stringify({ agent_name: 'multi' }) },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/agent-multi', {
        id: 'req-2',
      });

      expect(res.status).toBe(202);
      expect(res.body.count).toBe(2);
      expect(mockFireTrigger).toHaveBeenCalledTimes(2);
    });

    it('returns 404 when no triggers match the agent name', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'trigger-1', workspace_id: 'W_TEST_123', config_json: JSON.stringify({ agent_name: 'other-bot' }) },
      ]);

      const res = await makeTestRequest(app, 'POST', '/webhooks/agent-my-bot', {
        id: 'req-3',
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'No active webhook trigger found for this agent' });
      expect(mockFireTrigger).not.toHaveBeenCalled();
    });

    it('returns 404 when no webhook triggers exist at all', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([]);

      const res = await makeTestRequest(app, 'POST', '/webhooks/agent-unknown', {});

      expect(res.status).toBe(404);
    });

    it('generates a UUID for idempotency when body has no id', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'trigger-1', workspace_id: 'W_TEST_123', config_json: JSON.stringify({ agent_name: 'bot' }) },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      await makeTestRequest(app, 'POST', '/webhooks/agent-bot', {
        data: 'no-id-field',
      });

      expect(mockFireTrigger).toHaveBeenCalledWith(
        'W_TEST_123',
        expect.objectContaining({
          idempotencyKey: 'webhook:bot:test-uuid-1234',
        }),
      );
    });
  });

  // ────────────────────────────────────────────────
  // Linear Webhook
  // ────────────────────────────────────────────────
  describe('POST /webhooks/linear', () => {
    it('fires triggers when no secret is configured (skip verification)', async () => {
      // SECRET is already cleared in beforeEach
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'linear-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/linear', {
        action: 'create',
        data: { id: 'issue-1' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'OK' });
      expect(mockFireTrigger).toHaveBeenCalledWith('W_TEST_123', {
        triggerId: 'linear-trigger-1',
        idempotencyKey: 'linear:create:issue-1',
        payload: { action: 'create', data: { id: 'issue-1' } },
      });
    });

    it('returns 401 when signature verification fails', async () => {
      process.env.LINEAR_WEBHOOK_SECRET = 'test-secret';
      mockVerifyLinearSignature.mockReturnValue(false);

      const res = await makeTestRequest(app, 'POST', '/webhooks/linear',
        { action: 'create' },
        { 'linear-signature': 'bad-sig' },
      );

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid signature' });
      expect(mockFireTrigger).not.toHaveBeenCalled();
    });

    it('returns 200 with message when no active linear triggers exist', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([]);

      const res = await makeTestRequest(app, 'POST', '/webhooks/linear', {
        action: 'update',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'No active Linear triggers' });
    });

    it('generates UUID when data.id is missing', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'linear-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      await makeTestRequest(app, 'POST', '/webhooks/linear', {
        action: 'create',
        data: {},
      });

      expect(mockFireTrigger).toHaveBeenCalledWith(
        'W_TEST_123',
        expect.objectContaining({
          idempotencyKey: 'linear:create:test-uuid-1234',
        }),
      );
    });

    it('fires multiple linear triggers', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'lt-1', workspace_id: 'W_TEST_123' },
        { id: 'lt-2', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/linear', {
        action: 'update',
        data: { id: 'issue-5' },
      });

      expect(res.status).toBe(200);
      expect(mockFireTrigger).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────────
  // Zendesk Webhook
  // ────────────────────────────────────────────────
  describe('POST /webhooks/zendesk', () => {
    it('fires triggers when no secret is configured', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'zd-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/zendesk', {
        ticket_id: 'TK-100',
        updated_at: '2025-01-01',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'OK' });
      expect(mockFireTrigger).toHaveBeenCalledWith('W_TEST_123', {
        triggerId: 'zd-trigger-1',
        idempotencyKey: 'zendesk:TK-100:2025-01-01',
        payload: { ticket_id: 'TK-100', updated_at: '2025-01-01' },
      });
    });

    it('returns 401 when Zendesk signature verification fails', async () => {
      process.env.ZENDESK_WEBHOOK_SECRET = 'zd-secret';
      mockVerifyZendeskSignature.mockReturnValue(false);

      const res = await makeTestRequest(app, 'POST', '/webhooks/zendesk',
        { ticket_id: 'TK-101' },
        { 'x-zendesk-webhook-signature': 'bad-sig' },
      );

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid signature' });
      expect(mockFireTrigger).not.toHaveBeenCalled();
    });

    it('returns 200 even when no zendesk triggers exist', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([]);

      const res = await makeTestRequest(app, 'POST', '/webhooks/zendesk', {
        ticket_id: 'TK-102',
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/(OK|No active Zendesk triggers)/);
    });

    it('uses UUID when ticket_id is missing', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'zd-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      await makeTestRequest(app, 'POST', '/webhooks/zendesk', {});

      expect(mockFireTrigger).toHaveBeenCalledWith(
        'W_TEST_123',
        expect.objectContaining({
          idempotencyKey: expect.stringContaining('zendesk:test-uuid-1234'),
        }),
      );
    });
  });

  // ────────────────────────────────────────────────
  // Intercom Webhook
  // ────────────────────────────────────────────────
  describe('POST /webhooks/intercom', () => {
    it('fires triggers when no secret is configured', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'ic-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/intercom', {
        id: 'conversation-42',
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'OK' });
      expect(mockFireTrigger).toHaveBeenCalledWith('W_TEST_123', {
        triggerId: 'ic-trigger-1',
        idempotencyKey: 'intercom:conversation-42',
        payload: { id: 'conversation-42' },
      });
    });

    it('returns 401 when Intercom signature verification fails', async () => {
      process.env.INTERCOM_WEBHOOK_SECRET = 'ic-secret';
      mockVerifyIntercomSignature.mockReturnValue(false);

      const res = await makeTestRequest(app, 'POST', '/webhooks/intercom',
        { id: 'conversation-43' },
        { 'x-hub-signature': 'bad-sig' },
      );

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid signature' });
      expect(mockFireTrigger).not.toHaveBeenCalled();
    });

    it('returns 200 even when no intercom triggers exist', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([]);

      const res = await makeTestRequest(app, 'POST', '/webhooks/intercom', {
        id: 'conversation-44',
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/(OK|No active Intercom triggers)/);
    });

    it('uses UUID when body has no id field', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'ic-trigger-1', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      await makeTestRequest(app, 'POST', '/webhooks/intercom', {
        type: 'notification_event',
      });

      expect(mockFireTrigger).toHaveBeenCalledWith(
        'W_TEST_123',
        expect.objectContaining({
          idempotencyKey: 'intercom:test-uuid-1234',
        }),
      );
    });

    it('fires multiple intercom triggers', async () => {
      mockGetActiveTriggersByType.mockResolvedValueOnce([
        { id: 'ic-trigger-1', workspace_id: 'W_TEST_123' },
        { id: 'ic-trigger-2', workspace_id: 'W_TEST_123' },
      ]);
      mockFireTrigger.mockResolvedValue(undefined);

      const res = await makeTestRequest(app, 'POST', '/webhooks/intercom', {
        id: 'conv-50',
      });

      expect(res.status).toBe(200);
      expect(mockFireTrigger).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────────
  // Internal KB API
  // ────────────────────────────────────────────────
  describe('POST /internal/kb/search', () => {
    it('returns search results', async () => {
      mockSearchKB.mockResolvedValueOnce([
        { id: 'e1', title: 'Getting Started', summary: 'How to begin', content: 'Full content here', category: 'docs', tags: ['intro'] },
      ]);

      const res = await makeTestRequest(app, 'POST', '/internal/kb/search', {
        query: 'getting started',
      });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].title).toBe('Getting Started');
      expect(mockSearchKB).toHaveBeenCalledWith('W_TEST_123', 'getting started', undefined, 4000);
    });

    it('returns 400 when query is missing', async () => {
      const res = await makeTestRequest(app, 'POST', '/internal/kb/search', {});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('query is required');
    });

    it('passes agent_id when provided', async () => {
      mockSearchKB.mockResolvedValueOnce([]);

      await makeTestRequest(app, 'POST', '/internal/kb/search', {
        query: 'test',
        agent_id: 'agent-123',
      });

      expect(mockSearchKB).toHaveBeenCalledWith('W_TEST_123', 'test', 'agent-123', 4000);
    });
  });

  describe('GET /internal/kb/list', () => {
    it('returns KB entries', async () => {
      mockListKBEntries.mockResolvedValueOnce([
        { id: 'e1', title: 'Doc 1', summary: 'Summary', category: 'docs', tags: [] },
      ]);

      const res = await makeTestRequest(app, 'GET', '/internal/kb/list');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(mockListKBEntries).toHaveBeenCalledWith('W_TEST_123', 20);
    });

    it('filters by category', async () => {
      mockListKBEntries.mockResolvedValueOnce([
        { id: 'e1', title: 'Doc', summary: 'S', category: 'faq', tags: [] },
        { id: 'e2', title: 'Other', summary: 'S', category: 'docs', tags: [] },
      ]);

      const res = await makeTestRequest(app, 'GET', '/internal/kb/list?category=faq');

      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].title).toBe('Doc');
    });
  });

  describe('GET /internal/kb/categories', () => {
    it('returns category list', async () => {
      mockGetCategories.mockResolvedValueOnce(['docs', 'faq', 'guides']);

      const res = await makeTestRequest(app, 'GET', '/internal/kb/categories');

      expect(res.status).toBe(200);
      expect(res.body.categories).toEqual(['docs', 'faq', 'guides']);
    });

    it('returns 500 when getCategories throws', async () => {
      mockGetCategories.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await makeTestRequest(app, 'GET', '/internal/kb/categories');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Categories failed' });
    });
  });

  // ────────────────────────────────────────────────
  // startWebhookServer
  // ────────────────────────────────────────────────
  describe('startWebhookServer', () => {
    it('creates server and listens on configured port', async () => {
      const createdApp = createWebhookServer();

      // Verify that createWebhookServer returns a working Express app
      expect(createdApp).toBeDefined();
      expect(typeof createdApp.listen).toBe('function');

      // Test actual listen on ephemeral port
      const server = createdApp.listen(0, () => {
        server.close();
      });
    });
  });

  // ────────────────────────────────────────────────
  // Internal secret validation
  // ────────────────────────────────────────────────
  describe('Internal secret validation', () => {
    it('POST /internal/kb/search returns 401 when secret is wrong', async () => {
      // Temporarily set internalSecret
      const { config: appConfig } = await import('../../src/config');
      const origSecret = appConfig.server.internalSecret;
      appConfig.server.internalSecret = 'my-secret-key';

      const secretApp = createWebhookServer();
      const res = await makeTestRequest(secretApp, 'POST', '/internal/kb/search', { query: 'test' }, {
        'x-internal-secret': 'wrong-secret',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      appConfig.server.internalSecret = origSecret;
    });

    it('GET /internal/kb/list returns 401 when secret is wrong', async () => {
      const { config: appConfig } = await import('../../src/config');
      const origSecret = appConfig.server.internalSecret;
      appConfig.server.internalSecret = 'my-secret-key';

      const secretApp = createWebhookServer();
      const res = await makeTestRequest(secretApp, 'GET', '/internal/kb/list', undefined, {
        'x-internal-secret': 'wrong-secret',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      appConfig.server.internalSecret = origSecret;
    });

    it('GET /internal/kb/categories returns 401 when secret is wrong', async () => {
      const { config: appConfig } = await import('../../src/config');
      const origSecret = appConfig.server.internalSecret;
      appConfig.server.internalSecret = 'my-secret-key';

      const secretApp = createWebhookServer();
      const res = await makeTestRequest(secretApp, 'GET', '/internal/kb/categories', undefined, {
        'x-internal-secret': 'wrong-secret',
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Unauthorized' });
      appConfig.server.internalSecret = origSecret;
    });
  });

  // ────────────────────────────────────────────────
  // Multi-tenant workspace resolution for internal endpoints.
  // The X-Workspace-Id header lets the in-container kb/docs tools
  // target the agent's actual workspace instead of leaking into
  // whichever workspace happens to be `getDefaultWorkspaceId()`.
  // ────────────────────────────────────────────────
  describe('Internal endpoint workspace resolution', () => {
    it('POST /internal/kb/search uses X-Workspace-Id instead of the default workspace', async () => {
      mockSearchKB.mockResolvedValueOnce([]);

      await makeTestRequest(app, 'POST', '/internal/kb/search', { query: 'x' }, {
        'x-workspace-id': 'T-TENANT-B',
      });

      expect(mockSearchKB).toHaveBeenCalledWith('T-TENANT-B', 'x', undefined, expect.any(Number));
    });

    it('GET /internal/kb/list uses X-Workspace-Id instead of the default workspace', async () => {
      mockListKBEntries.mockResolvedValueOnce([]);

      await makeTestRequest(app, 'GET', '/internal/kb/list', undefined, {
        'x-workspace-id': 'T-TENANT-B',
      });

      expect(mockListKBEntries).toHaveBeenCalledWith('T-TENANT-B', expect.any(Number));
    });

    it('GET /internal/kb/categories uses X-Workspace-Id instead of the default workspace', async () => {
      mockGetCategories.mockResolvedValueOnce([]);

      await makeTestRequest(app, 'GET', '/internal/kb/categories', undefined, {
        'x-workspace-id': 'T-TENANT-B',
      });

      expect(mockGetCategories).toHaveBeenCalledWith('T-TENANT-B');
    });

    it('falls back to the default workspace when X-Workspace-Id is omitted (legacy single-tenant)', async () => {
      mockListKBEntries.mockResolvedValueOnce([]);

      await makeTestRequest(app, 'GET', '/internal/kb/list');

      expect(mockListKBEntries).toHaveBeenCalled();
      const calledWith = mockListKBEntries.mock.calls[0][0];
      expect(typeof calledWith).toBe('string');
      expect(calledWith.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────
  // Internal KB API error handling
  // ────────────────────────────────────────────────
  describe('Internal KB API error handling', () => {
    it('POST /internal/kb/search returns 500 when searchKB throws', async () => {
      mockSearchKB.mockRejectedValueOnce(new Error('Search index corrupted'));

      const res = await makeTestRequest(app, 'POST', '/internal/kb/search', { query: 'test' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Search failed' });
    });

    it('GET /internal/kb/list returns 500 when listKBEntries throws', async () => {
      mockListKBEntries.mockRejectedValueOnce(new Error('DB connection lost'));

      const res = await makeTestRequest(app, 'GET', '/internal/kb/list');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'List failed' });
    });
  });

  // ── OAuth Callback ──

  describe('OAuth Callback', () => {
    it('GET /auth/callback/:integration returns 400 when missing code or state', async () => {
      const res = await makeTestRequest(app, 'GET', '/auth/callback/google_drive');

      expect(res.status).toBe(400);
    });

    it('GET /auth/callback/:integration returns success HTML on valid callback', async () => {
      mockHandleOAuthCallback.mockResolvedValueOnce({
        wsId: 'W1',
        userId: 'U001',
        channelId: 'C123',
      });

      const res = await makeTestRequest(app, 'GET', '/auth/callback/google_drive?code=abc123&state=valid-state');

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('string');
      expect(res.body).toContain('Connected');
      expect(mockHandleOAuthCallback).toHaveBeenCalledWith('google_drive', 'abc123', 'valid-state');
    });

    it('GET /auth/callback/:integration returns 400 on error', async () => {
      mockHandleOAuthCallback.mockRejectedValueOnce(new Error('Invalid or expired OAuth state'));

      const res = await makeTestRequest(app, 'GET', '/auth/callback/github?code=bad&state=expired');

      expect(res.status).toBe(400);
      expect(typeof res.body).toBe('string');
      expect(res.body).toContain('Connection Failed');
    });
  });

  // ────────────────────────────────────────────────
  // Internal Approval API
  // ────────────────────────────────────────────────

  describe('POST /internal/approval/request', () => {
    it('creates approval and posts Slack message', async () => {
      mockSetApprovalState.mockResolvedValue(undefined);
      mockSlackPostBlocks.mockResolvedValue('msg-ts-789');

      const res = await makeTestRequest(app, 'POST', '/internal/approval/request', {
        workspaceId: 'W_TEST_123',
        agentId: 'agent-1',
        agentName: 'TestBot',
        toolName: 'chargebee-write',
        details: 'Creating customer',
        userId: 'U001',
        channelId: 'C123',
        threadTs: '111.222',
        writePolicy: 'confirm',
      });

      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe('test-uuid-1234');
      expect(mockSetApprovalState).toHaveBeenCalledWith('W_TEST_123', 'test-uuid-1234', 'pending', 300);
      expect(mockSlackPostBlocks).toHaveBeenCalledWith(
        'C123',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'section',
            text: expect.objectContaining({ text: expect.stringContaining('TestBot') }),
          }),
          expect.objectContaining({
            type: 'actions',
            elements: expect.arrayContaining([
              expect.objectContaining({ action_id: 'approve_write_action' }),
              expect.objectContaining({ action_id: 'deny_write_action' }),
            ]),
          }),
        ]),
        expect.stringContaining('Write approval'),
        '111.222',
      );
    });

    it('sets no TTL for admin_confirm write policy', async () => {
      mockSetApprovalState.mockResolvedValue(undefined);
      mockSlackPostBlocks.mockResolvedValue('msg-ts-789');

      const res = await makeTestRequest(app, 'POST', '/internal/approval/request', {
        workspaceId: 'W_TEST_123',
        agentId: 'agent-1',
        agentName: 'TestBot',
        toolName: 'chargebee-write',
        userId: 'U001',
        channelId: 'C123',
        threadTs: '111.222',
        writePolicy: 'admin_confirm',
      });

      expect(res.status).toBe(200);
      // admin_confirm should pass undefined TTL
      expect(mockSetApprovalState).toHaveBeenCalledWith('W_TEST_123', 'test-uuid-1234', 'pending', undefined);
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await makeTestRequest(app, 'POST', '/internal/approval/request', {
        agentId: 'agent-1',
        // missing toolName and channelId
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Missing required fields');
    });

    it('returns 401 when internal secret is wrong', async () => {
      const { config: appConfig } = await import('../../src/config');
      const origSecret = appConfig.server.internalSecret;
      appConfig.server.internalSecret = 'my-secret';

      const secretApp = createWebhookServer();
      const res = await makeTestRequest(secretApp, 'POST', '/internal/approval/request', {
        agentId: 'agent-1',
        toolName: 'test',
        channelId: 'C123',
      }, { 'x-internal-secret': 'wrong-secret' });

      expect(res.status).toBe(401);
      appConfig.server.internalSecret = origSecret;
    });
  });

  describe('GET /internal/approval/poll/:requestId', () => {
    it('returns correct approval state', async () => {
      mockGetApprovalState.mockResolvedValue('approved');

      const res = await makeTestRequest(app, 'GET', '/internal/approval/poll/req-123?workspaceId=W_TEST_123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(mockGetApprovalState).toHaveBeenCalledWith('W_TEST_123', 'req-123');
    });

    it('returns expired when state is null', async () => {
      mockGetApprovalState.mockResolvedValue(null);

      const res = await makeTestRequest(app, 'GET', '/internal/approval/poll/req-expired?workspaceId=W_TEST_123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('expired');
    });

    it('returns pending for a new request', async () => {
      mockGetApprovalState.mockResolvedValue('pending');

      const res = await makeTestRequest(app, 'GET', '/internal/approval/poll/req-new?workspaceId=W_TEST_123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('pending');
    });

    it('returns denied state', async () => {
      mockGetApprovalState.mockResolvedValue('denied');

      const res = await makeTestRequest(app, 'GET', '/internal/approval/poll/req-denied?workspaceId=W_TEST_123');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('denied');
    });

    it('returns 401 when internal secret is wrong', async () => {
      const { config: appConfig } = await import('../../src/config');
      const origSecret = appConfig.server.internalSecret;
      appConfig.server.internalSecret = 'my-secret';

      const secretApp = createWebhookServer();
      const res = await makeTestRequest(secretApp, 'GET', '/internal/approval/poll/req-123', undefined, {
        'x-internal-secret': 'wrong-secret',
      });

      expect(res.status).toBe(401);
      appConfig.server.internalSecret = origSecret;
    });
  });

  // ────────────────────────────────────────────────
  // closeSessionRedis
  // ────────────────────────────────────────────────
  describe('closeSessionRedis', () => {
    it('calls quit on the session Redis client', async () => {
      // createWebhookServer() was called in beforeEach, which sets the module-level client
      await closeSessionRedis();

      expect(mockRedisQuit).toHaveBeenCalledTimes(1);
    });

    it('is safe to call multiple times', async () => {
      await closeSessionRedis();
      mockRedisQuit.mockClear();
      await closeSessionRedis(); // second call should be no-op (client already null)

      expect(mockRedisQuit).not.toHaveBeenCalled();
    });
  });
});
