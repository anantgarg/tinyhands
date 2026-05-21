import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

// ── Mocks ──

const mockGetWebChatByToken = vi.fn();
const mockVerifyWebChatCredential = vi.fn();
const mockVerifyChatSession = vi.fn();
const mockCreateSession = vi.fn();
const mockSessionBelongsToChannel = vi.fn();
const mockDispatchWebChatMessage = vi.fn();
const mockHasAssistantMessage = vi.fn();
const mockAppendMessage = vi.fn();

vi.mock('../../src/modules/web-chat', () => ({
  getWebChatByToken: (...a: any[]) => mockGetWebChatByToken(...a),
  verifyWebChatCredential: (...a: any[]) => mockVerifyWebChatCredential(...a),
  verifyChatSession: (...a: any[]) => mockVerifyChatSession(...a),
  signChatSession: () => 'signed-session-value',
  chatCookieName: (token: string) => `wc_${token}`,
  createSession: (...a: any[]) => mockCreateSession(...a),
  sessionBelongsToChannel: (...a: any[]) => mockSessionBelongsToChannel(...a),
  dispatchWebChatMessage: (...a: any[]) => mockDispatchWebChatMessage(...a),
  hasAssistantMessage: (...a: any[]) => mockHasAssistantMessage(...a),
  appendMessage: (...a: any[]) => mockAppendMessage(...a),
}));

const mockQueryOne = vi.fn();
vi.mock('../../src/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
}));

const mockCheckRateLimit = vi.fn();
vi.mock('../../src/queue', () => ({
  checkRateLimit: (...a: any[]) => mockCheckRateLimit(...a),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerPublicChatRoutes } from '../../src/api/public-chat';

const CHANNEL = {
  id: 'wc-1',
  workspace_id: 'W1',
  name: 'Support Chat',
  agent_id: 'agent-1',
  public_token: 'tok1',
  enabled: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  registerPublicChatRoutes(app);
  return app;
}

function request(
  app: express.Application,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, any>,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any; setCookie: string[] }> {
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
            ...(headers || {}),
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
            resolve({
              status: res.statusCode || 0,
              body: parsed,
              setCookie: (res.headers['set-cookie'] as string[]) || [],
            });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

const AUTH_COOKIE = { Cookie: 'wc_tok1=valid' };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyChatSession.mockImplementation((value: string) => value === 'valid');
  mockCheckRateLimit.mockResolvedValue({ allowed: true, usage: 0 });
});

// ── Metadata ──

describe('GET /api/public/chat/:token', () => {
  it('returns metadata for an enabled web chat', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ name: 'Helper', avatar_emoji: '🤖' });
    const res = await request(buildApp(), 'GET', '/api/public/chat/tok1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Support Chat', agentName: 'Helper', agentEmoji: '🤖' });
  });

  it('returns 404 for an unknown token', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(undefined);
    const res = await request(buildApp(), 'GET', '/api/public/chat/nope');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a disabled web chat', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce({ ...CHANNEL, enabled: false });
    const res = await request(buildApp(), 'GET', '/api/public/chat/tok1');
    expect(res.status).toBe(404);
  });

  it('returns 500 when metadata lookup throws', async () => {
    mockGetWebChatByToken.mockRejectedValueOnce(new Error('db down'));
    const res = await request(buildApp(), 'GET', '/api/public/chat/tok1');
    expect(res.status).toBe(500);
  });
});

// ── Login ──

describe('POST /api/public/chat/:token/login', () => {
  it('rejects incorrect credentials with 401', async () => {
    mockVerifyWebChatCredential.mockResolvedValueOnce(null);
    const res = await request(buildApp(), 'POST', '/api/public/chat/tok1/login', {
      username: 'guest',
      password: 'wrong',
    });
    expect(res.status).toBe(401);
    expect(res.setCookie).toHaveLength(0);
  });

  it('sets a session cookie on success', async () => {
    mockVerifyWebChatCredential.mockResolvedValueOnce(CHANNEL);
    const res = await request(buildApp(), 'POST', '/api/public/chat/tok1/login', {
      username: 'guest',
      password: 'right',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.setCookie.join(';')).toContain('wc_tok1=');
  });

  it('returns 500 when credential check throws', async () => {
    mockVerifyWebChatCredential.mockRejectedValueOnce(new Error('boom'));
    const res = await request(buildApp(), 'POST', '/api/public/chat/tok1/login', {
      username: 'guest',
      password: 'right',
    });
    expect(res.status).toBe(500);
  });
});

// ── Message ──

describe('POST /api/public/chat/:token/message', () => {
  it('requires a valid session cookie', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    const res = await request(buildApp(), 'POST', '/api/public/chat/tok1/message', { text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('enqueues a message and returns the trace id', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockCreateSession.mockResolvedValueOnce('sess-1');
    mockDispatchWebChatMessage.mockResolvedValueOnce({ traceId: 'trace-1' });
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'hello' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: 'sess-1', traceId: 'trace-1' });
  });

  it('rejects an empty message', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: '   ' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(400);
  });

  it('returns 429 when the workspace is rate limited', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockCheckRateLimit.mockResolvedValueOnce({ allowed: false, usage: 1 });
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'hi' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(429);
  });

  it('returns 404 for a disabled or unknown web chat', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(undefined);
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'hi' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(404);
  });

  it('rejects a session id that does not belong to the web chat', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockSessionBelongsToChannel.mockResolvedValueOnce(false);
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'hi', sessionId: 'other-sess' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(400);
  });

  it('continues an existing session when the session id is valid', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockSessionBelongsToChannel.mockResolvedValueOnce(true);
    mockDispatchWebChatMessage.mockResolvedValueOnce({ traceId: 'trace-2' });
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'again', sessionId: 'sess-1' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionId: 'sess-1', traceId: 'trace-2' });
  });

  it('returns 500 when dispatch throws', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockCreateSession.mockResolvedValueOnce('sess-1');
    mockDispatchWebChatMessage.mockRejectedValueOnce(new Error('boom'));
    const res = await request(
      buildApp(),
      'POST',
      '/api/public/chat/tok1/message',
      { text: 'hi' },
      AUTH_COOKIE,
    );
    expect(res.status).toBe(500);
  });
});

// ── Poll ──

describe('GET /api/public/chat/:token/message/:traceId', () => {
  it('reports running while the run is in progress', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ status: 'running', output: '' });
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.body).toEqual({ status: 'running' });
  });

  it('returns the reply once the run completes', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ status: 'completed', output: 'the answer' });
    mockSessionBelongsToChannel.mockResolvedValueOnce(true);
    mockHasAssistantMessage.mockResolvedValueOnce(false);
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1?sessionId=sess-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.body).toEqual({ status: 'done', content: 'the answer' });
    expect(mockAppendMessage).toHaveBeenCalledWith('sess-1', 'assistant', 'the answer', 'trace-1');
  });

  it('reports an error when the run failed', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ status: 'failed', output: '' });
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.body).toEqual({ status: 'error' });
  });

  it('requires a valid session cookie', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    const res = await request(buildApp(), 'GET', '/api/public/chat/tok1/message/trace-1');
    expect(res.status).toBe(401);
  });

  it('reports running when the run has not been recorded yet', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce(undefined);
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.body).toEqual({ status: 'running' });
  });

  it('does not double-record the assistant reply', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockResolvedValueOnce({ status: 'completed', output: 'answer' });
    mockSessionBelongsToChannel.mockResolvedValueOnce(true);
    mockHasAssistantMessage.mockResolvedValueOnce(true);
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1?sessionId=sess-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.body.status).toBe('done');
    expect(mockAppendMessage).not.toHaveBeenCalled();
  });

  it('returns 500 when the run lookup throws', async () => {
    mockGetWebChatByToken.mockResolvedValueOnce(CHANNEL);
    mockQueryOne.mockRejectedValueOnce(new Error('db down'));
    const res = await request(
      buildApp(),
      'GET',
      '/api/public/chat/tok1/message/trace-1',
      undefined,
      AUTH_COOKIE,
    );
    expect(res.status).toBe(500);
  });
});
