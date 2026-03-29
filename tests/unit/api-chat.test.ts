import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockChatSync = vi.fn();
const mockStreamChat = vi.fn();

vi.mock('../../src/modules/chat-assistant', () => ({
  chatSync: (...args: any[]) => mockChatSync(...args),
  streamChat: (...args: any[]) => mockStreamChat(...args),
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

function makeSSERequest(
  app: express.Express,
  path: string,
  body: Record<string, any>,
): Promise<{ status: number; events: any[] }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Could not get server address'));
        return;
      }

      const payload = JSON.stringify(body);
      const options: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: addr.port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload).toString(),
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          const events = data.split('\n\n')
            .filter(line => line.startsWith('data: '))
            .map(line => {
              try { return JSON.parse(line.slice(6)); } catch { return null; }
            })
            .filter(Boolean);
          resolve({ status: res.statusCode || 0, events });
        });
      });

      req.on('error', (err) => { server.close(); reject(err); });
      req.write(payload);
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

  describe('POST /chat (non-streaming)', () => {
    it('returns 400 when neither message nor messages is provided', async () => {
      const res = await makeRequest(app, 'POST', '/chat', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'message or messages is required' });
    });

    it('calls chatSync with single message format', async () => {
      mockChatSync.mockResolvedValueOnce({
        response: 'Hello! I can help you with your agents.',
        toolCallsUsed: [],
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Hello',
      });

      expect(res.status).toBe(200);
      expect(res.body.response).toBe('Hello! I can help you with your agents.');
      expect(mockChatSync).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'Hello' }],
        agentId: undefined,
        context: 'general',
        modelOverride: undefined,
        workspaceId: 'W123',
        userId: 'U123',
      });
    });

    it('calls chatSync with messages array format', async () => {
      mockChatSync.mockResolvedValueOnce({
        response: 'Based on our conversation...',
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        messages: [
          { role: 'user', content: 'Tell me about my agents' },
          { role: 'assistant', content: 'You have 3 agents.' },
          { role: 'user', content: 'Which one has errors?' },
        ],
      });

      expect(res.status).toBe(200);
      expect(mockChatSync).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'user', content: 'Tell me about my agents' },
            { role: 'assistant', content: 'You have 3 agents.' },
            { role: 'user', content: 'Which one has errors?' },
          ],
        }),
      );
    });

    it('returns proposed changes from chatSync', async () => {
      mockChatSync.mockResolvedValueOnce({
        response: 'I have 1 proposed change for "Test Bot".',
        proposedChanges: {
          model: { from: 'sonnet', to: 'opus' },
        },
        canApply: true,
      });

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Change the model to Opus',
        agentId: 'a1',
      });

      expect(res.status).toBe(200);
      expect(res.body.proposedChanges).toEqual({
        model: { from: 'sonnet', to: 'opus' },
      });
      expect(res.body.canApply).toBe(true);
    });

    it('passes model override when valid', async () => {
      mockChatSync.mockResolvedValueOnce({ response: 'Done.' });

      await makeRequest(app, 'POST', '/chat', {
        message: 'Analyze this',
        modelOverride: 'opus',
      });

      expect(mockChatSync).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: 'opus',
        }),
      );
    });

    it('ignores invalid model override', async () => {
      mockChatSync.mockResolvedValueOnce({ response: 'Done.' });

      await makeRequest(app, 'POST', '/chat', {
        message: 'Analyze this',
        modelOverride: 'gpt-4',
      });

      expect(mockChatSync).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: undefined,
        }),
      );
    });

    it('returns 500 on unexpected error', async () => {
      mockChatSync.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await makeRequest(app, 'POST', '/chat', {
        message: 'Hello',
      });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to process chat message' });
    });
  });

  describe('POST /chat/stream (SSE)', () => {
    it('returns 400 when messages is missing', async () => {
      const res = await makeRequest(app, 'POST', '/chat/stream', {});

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'messages array is required' });
    });

    it('returns 400 when messages is empty array', async () => {
      const res = await makeRequest(app, 'POST', '/chat/stream', {
        messages: [],
      });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'messages array is required' });
    });

    it('streams events from streamChat', async () => {
      mockStreamChat.mockImplementation(async (_req: any, onEvent: any) => {
        onEvent({ type: 'text', content: 'Hello ' });
        onEvent({ type: 'text', content: 'world!' });
        onEvent({ type: 'done', toolCallsUsed: [] });
      });

      const result = await makeSSERequest(app, '/chat/stream', {
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.status).toBe(200);
      expect(result.events).toHaveLength(3);
      expect(result.events[0]).toEqual({ type: 'text', content: 'Hello ' });
      expect(result.events[1]).toEqual({ type: 'text', content: 'world!' });
      expect(result.events[2]).toEqual({ type: 'done', toolCallsUsed: [] });
    });

    it('streams tool_call events during diagnostic analysis', async () => {
      mockStreamChat.mockImplementation(async (_req: any, onEvent: any) => {
        onEvent({ type: 'tool_call', name: 'get_recent_runs', label: 'Checking recent activity...' });
        onEvent({ type: 'tool_call', name: 'get_error_rates', label: 'Checking error rates...' });
        onEvent({ type: 'text', content: 'Your agent has a 25% error rate.' });
        onEvent({ type: 'done', toolCallsUsed: ['Checking recent activity', 'Checking error rates'] });
      });

      const result = await makeSSERequest(app, '/chat/stream', {
        messages: [{ role: 'user', content: 'Why is my agent failing?' }],
        agentId: 'a1',
      });

      expect(result.events[0]).toEqual({
        type: 'tool_call',
        name: 'get_recent_runs',
        label: 'Checking recent activity...',
      });
      expect(result.events.filter(e => e.type === 'tool_call')).toHaveLength(2);
    });

    it('streams proposed_changes events', async () => {
      mockStreamChat.mockImplementation(async (_req: any, onEvent: any) => {
        onEvent({ type: 'text', content: 'I suggest changing the model.' });
        onEvent({
          type: 'proposed_changes',
          changes: { model: { from: 'sonnet', to: 'opus' } },
          canApply: true,
        });
        onEvent({ type: 'done', toolCallsUsed: [] });
      });

      const result = await makeSSERequest(app, '/chat/stream', {
        messages: [{ role: 'user', content: 'Use Opus' }],
        agentId: 'a1',
      });

      const changeEvent = result.events.find(e => e.type === 'proposed_changes');
      expect(changeEvent).toBeDefined();
      expect(changeEvent.changes).toEqual({ model: { from: 'sonnet', to: 'opus' } });
      expect(changeEvent.canApply).toBe(true);
    });

    it('passes agentId and context to streamChat', async () => {
      mockStreamChat.mockImplementation(async (_req: any, onEvent: any) => {
        onEvent({ type: 'done', toolCallsUsed: [] });
      });

      await makeSSERequest(app, '/chat/stream', {
        messages: [{ role: 'user', content: 'Why is this failing?' }],
        agentId: 'agent-123',
        context: 'agent',
      });

      expect(mockStreamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-123',
          context: 'agent',
          workspaceId: 'W123',
          userId: 'U123',
        }),
        expect.any(Function),
      );
    });
  });
});
