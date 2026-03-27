import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockGetAgent = vi.fn();
const mockListAgents = vi.fn();

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  listAgents: (...args: any[]) => mockListAgents(...args),
}));

const mockAnalyzeGoal = vi.fn();

vi.mock('../../src/modules/agents/goal-analyzer', () => ({
  analyzeGoal: (...args: any[]) => mockAnalyzeGoal(...args),
}));

const mockCanModifyAgent = vi.fn();

vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import chatRoutes from '../../src/api/routes/chat';

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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.session = {
      user: {
        userId: 'U123',
        workspaceId: 'W123',
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        platformRole: 'admin',
      },
    };
    req.sessionUser = req.session.user;
    next();
  });
  app.use('/chat', chatRoutes);
  return app;
}

// ── Tests ──

describe('Chat Routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /chat', () => {
    it('returns 400 when message is missing', async () => {
      const res = await makeRequest(app, 'POST', '/chat', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'message is required' });
    });

    it('returns 400 when message is not a string', async () => {
      const res = await makeRequest(app, 'POST', '/chat', { message: 123 });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'message is required' });
    });

    it('returns general guidance when no agentId is provided', async () => {
      mockListAgents.mockResolvedValueOnce([
        { name: 'Bot1' },
        { name: 'Bot2' },
      ]);

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'How do I create an agent?',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toBeDefined();
      expect(typeof res.body.response).toBe('string');
      expect(mockListAgents).toHaveBeenCalledWith('W123');
    });

    it('returns dashboard context response', async () => {
      mockListAgents.mockResolvedValueOnce([{ name: 'Bot1' }]);

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'What agents do I have?',
        context: 'dashboard',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toContain('1 agent');
    });

    it('returns tools context response', async () => {
      mockListAgents.mockResolvedValueOnce([]);

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'How do I add a tool?',
        context: 'tools',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toContain('tool');
    });

    it('returns kb context response', async () => {
      mockListAgents.mockResolvedValueOnce([]);

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'How do I manage KB?',
        context: 'kb',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toContain('knowledge base');
    });

    it('returns 404 when agentId is provided but agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Update this agent',
        agentId: 'nonexistent',
      });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Agent not found' });
    });

    it('analyzes goal and returns proposed changes for agent context', async () => {
      const agent = {
        id: 'a1',
        name: 'Test Bot',
        system_prompt: 'You are a test bot',
        model: 'sonnet',
        tools: ['Read'],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
      };
      mockGetAgent.mockResolvedValueOnce(agent);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockAnalyzeGoal.mockResolvedValueOnce({
        agent_name: 'Test Bot',
        system_prompt: 'You are an updated test bot',
        model: 'sonnet',
        tools: ['Read', 'Write'],
        memory_enabled: true,
        respond_to_all_messages: false,
        mentions_only: false,
        summary: 'Updated the prompt and enabled memory.',
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Enable memory and update the prompt',
        agentId: 'a1',
      });

      expect(res.status).toBe(200);
      expect(res.body.proposedChanges).toBeDefined();
      expect(res.body.proposedChanges.systemPrompt).toEqual({
        from: 'You are a test bot',
        to: 'You are an updated test bot',
      });
      expect(res.body.proposedChanges.memoryEnabled).toEqual({
        from: false,
        to: true,
      });
      expect(res.body.proposedChanges.tools).toEqual({
        from: ['Read'],
        to: ['Read', 'Write'],
      });
      expect(res.body.canApply).toBe(true);
      expect(mockAnalyzeGoal).toHaveBeenCalledWith(
        'W123', 'Enable memory and update the prompt',
        'You are a test bot', 'U123', 'Test Bot',
      );
    });

    it('returns canApply false when user cannot modify agent', async () => {
      const agent = {
        id: 'a1',
        name: 'Test Bot',
        system_prompt: 'You are a test bot',
        model: 'sonnet',
        tools: ['Read'],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
      };
      mockGetAgent.mockResolvedValueOnce(agent);
      mockCanModifyAgent.mockResolvedValueOnce(false);
      mockAnalyzeGoal.mockResolvedValueOnce({
        agent_name: 'Test Bot',
        system_prompt: 'Updated prompt',
        model: 'sonnet',
        tools: ['Read'],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
        summary: 'Updated the prompt.',
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Change the prompt',
        agentId: 'a1',
      });

      expect(res.status).toBe(200);
      expect(res.body.canApply).toBe(false);
      expect(res.body.response).toContain('do not have permission');
    });

    it('returns no changes when agent config matches', async () => {
      const agent = {
        id: 'a1',
        name: 'Test Bot',
        system_prompt: 'You are a test bot',
        model: 'sonnet',
        tools: ['Read'],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
      };
      mockGetAgent.mockResolvedValueOnce(agent);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockAnalyzeGoal.mockResolvedValueOnce({
        agent_name: 'Test Bot',
        system_prompt: 'You are a test bot',
        model: 'sonnet',
        tools: ['Read'],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
        summary: 'Already configured as described.',
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Keep everything the same',
        agentId: 'a1',
      });

      expect(res.status).toBe(200);
      expect(res.body.proposedChanges).toBeUndefined();
      expect(res.body.response).toContain('No changes needed');
    });

    it('handles goal analysis failure gracefully', async () => {
      const agent = {
        id: 'a1',
        name: 'Test Bot',
        system_prompt: 'You are a test bot',
        model: 'sonnet',
        tools: [],
        memory_enabled: false,
        respond_to_all_messages: false,
        mentions_only: false,
      };
      mockGetAgent.mockResolvedValueOnce(agent);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockAnalyzeGoal.mockRejectedValueOnce(new Error('API timeout'));

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Do something',
        agentId: 'a1',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toContain('I had trouble processing your request');
    });

    it('returns 500 on unexpected error', async () => {
      // Simulate error in getSessionUser by not setting up middleware
      const brokenApp = express();
      brokenApp.use(express.json());
      brokenApp.use((req: any, _res: any, next: any) => {
        // Intentionally not setting sessionUser to cause error
        req.sessionUser = {
          userId: 'U123',
          workspaceId: 'W123',
          displayName: 'Test',
          avatarUrl: '',
          platformRole: 'admin',
        };
        next();
      });
      brokenApp.use('/chat', chatRoutes);

      mockListAgents.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await makeRequest(brokenApp, 'POST', '/chat', {
        message: 'Hello',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to process chat message' });
    });
  });
});
