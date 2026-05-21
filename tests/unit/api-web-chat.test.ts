import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const mockListWebChats = vi.fn();
const mockGetWebChat = vi.fn();
const mockCreateWebChat = vi.fn();
const mockUpdateWebChat = vi.fn();
const mockDeleteWebChat = vi.fn();
const mockDecryptWebChatPassword = vi.fn();

vi.mock('../../src/modules/web-chat', () => ({
  listWebChats: (...a: any[]) => mockListWebChats(...a),
  getWebChat: (...a: any[]) => mockGetWebChat(...a),
  createWebChat: (...a: any[]) => mockCreateWebChat(...a),
  updateWebChat: (...a: any[]) => mockUpdateWebChat(...a),
  deleteWebChat: (...a: any[]) => mockDeleteWebChat(...a),
  decryptWebChatPassword: (...a: any[]) => mockDecryptWebChatPassword(...a),
}));

const mockQueryOne = vi.fn();
vi.mock('../../src/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import webChatRoutes from '../../src/api/routes/web-chat';

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
        reject(new Error('no address'));
        return;
      }
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            server.close();
            let parsed: any;
            try { parsed = JSON.parse(data); } catch { parsed = data; }
            resolve({ status: res.statusCode || 0, body: parsed });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function createApp(role: string = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = {
      user: { userId: 'U1', workspaceId: 'W1', displayName: 'Test', avatarUrl: '', platformRole: role },
    };
    req.sessionUser = req.session.user;
    next();
  });
  app.use('/web-chat', webChatRoutes);
  return app;
}

const CHANNEL = {
  id: 'wc-1',
  workspace_id: 'W1',
  name: 'Support',
  slug: 'support',
  agent_id: 'agent-1',
  auth_username: 'guest',
  auth_password_encrypted: 'enc',
  auth_password_iv: 'iv',
  public_token: 'tok1',
  enabled: true,
  created_by: 'U1',
  created_at: 'now',
  updated_at: 'now',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDecryptWebChatPassword.mockReturnValue('s3cret');
  mockQueryOne.mockResolvedValue({ name: 'Helper', model: 'claude-sonnet' });
});

describe('Web Chat admin routes', () => {
  it('blocks non-admins', async () => {
    const res = await makeRequest(createApp('member'), 'GET', '/web-chat/channels');
    expect(res.status).toBe(403);
  });

  it('lists web chats with the agent name and decrypted password', async () => {
    mockListWebChats.mockResolvedValueOnce([CHANNEL]);
    const res = await makeRequest(createApp(), 'GET', '/web-chat/channels');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 'wc-1',
      name: 'Support',
      agentName: 'Helper',
      username: 'guest',
      password: 's3cret',
      publicToken: 'tok1',
      enabled: true,
    });
  });

  it('creates a web chat', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'agent-1' }) // agent existence check
      .mockResolvedValueOnce({ name: 'Helper', model: 'claude-sonnet' }); // shape lookup
    mockCreateWebChat.mockResolvedValueOnce(CHANNEL);
    const res = await makeRequest(createApp(), 'POST', '/web-chat/channels', {
      name: 'Support',
      agentId: 'agent-1',
      username: 'guest',
      password: 's3cret',
    });
    expect(res.status).toBe(201);
    expect(mockCreateWebChat).toHaveBeenCalled();
  });

  it('rejects creation with missing fields', async () => {
    const res = await makeRequest(createApp(), 'POST', '/web-chat/channels', { name: 'Support' });
    expect(res.status).toBe(400);
  });

  it('rejects creation with an unknown agent', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined); // agent check fails
    const res = await makeRequest(createApp(), 'POST', '/web-chat/channels', {
      name: 'Support',
      agentId: 'ghost',
      username: 'guest',
      password: 'pw',
    });
    expect(res.status).toBe(400);
  });

  it('updates a web chat', async () => {
    mockGetWebChat.mockResolvedValueOnce(CHANNEL);
    mockUpdateWebChat.mockResolvedValueOnce({ ...CHANNEL, enabled: false });
    const res = await makeRequest(createApp(), 'PATCH', '/web-chat/channels/wc-1', { enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('returns 404 updating an unknown web chat', async () => {
    mockGetWebChat.mockResolvedValueOnce(undefined);
    const res = await makeRequest(createApp(), 'PATCH', '/web-chat/channels/ghost', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('deletes a web chat', async () => {
    mockGetWebChat.mockResolvedValueOnce(CHANNEL);
    mockDeleteWebChat.mockResolvedValueOnce(undefined);
    const res = await makeRequest(createApp(), 'DELETE', '/web-chat/channels/wc-1');
    expect(res.status).toBe(204);
    expect(mockDeleteWebChat).toHaveBeenCalledWith('W1', 'wc-1');
  });

  it('returns 404 deleting an unknown web chat', async () => {
    mockGetWebChat.mockResolvedValueOnce(undefined);
    const res = await makeRequest(createApp(), 'DELETE', '/web-chat/channels/ghost');
    expect(res.status).toBe(404);
  });

  it('returns 500 when listing fails', async () => {
    mockListWebChats.mockRejectedValueOnce(new Error('db down'));
    const res = await makeRequest(createApp(), 'GET', '/web-chat/channels');
    expect(res.status).toBe(500);
  });

  it('returns 500 when creation fails', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'agent-1' });
    mockCreateWebChat.mockRejectedValueOnce(new Error('boom'));
    const res = await makeRequest(createApp(), 'POST', '/web-chat/channels', {
      name: 'Support',
      agentId: 'agent-1',
      username: 'guest',
      password: 'pw',
    });
    expect(res.status).toBe(500);
  });

  it('updates the attached agent after validating it exists', async () => {
    mockGetWebChat.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ id: 'agent-2' }); // agent check
    mockUpdateWebChat.mockResolvedValueOnce({ ...CHANNEL, agent_id: 'agent-2' });
    const res = await makeRequest(createApp(), 'PATCH', '/web-chat/channels/wc-1', { agentId: 'agent-2' });
    expect(res.status).toBe(200);
  });

  it('rejects an update that points at an unknown agent', async () => {
    mockGetWebChat.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce(undefined); // agent check fails
    const res = await makeRequest(createApp(), 'PATCH', '/web-chat/channels/wc-1', { agentId: 'ghost' });
    expect(res.status).toBe(400);
  });

  it('returns 500 when deletion fails', async () => {
    mockGetWebChat.mockResolvedValueOnce(CHANNEL);
    mockDeleteWebChat.mockRejectedValueOnce(new Error('boom'));
    const res = await makeRequest(createApp(), 'DELETE', '/web-chat/channels/wc-1');
    expect(res.status).toBe(500);
  });
});
