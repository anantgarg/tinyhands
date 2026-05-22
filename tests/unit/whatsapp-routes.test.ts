import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';

// ── Mocks ──

const m = vi.hoisted(() => ({
  listWhatsAppChannels: vi.fn(),
  getWhatsAppChannel: vi.fn(),
  getWhatsAppChannelByNumber: vi.fn(),
  createWhatsAppChannel: vi.fn(),
  updateWhatsAppChannel: vi.fn(),
  deleteWhatsAppChannel: vi.fn(),
  listAllowedNumbers: vi.fn(),
  replaceAllowedNumbers: vi.fn(),
  decryptAuthToken: vi.fn(),
  isNumberAllowed: vi.fn(),
  getOrCreateSession: vi.fn(),
  getMessageByTwilioSid: vi.fn(),
  dispatchWhatsAppMessage: vi.fn(),
}));

vi.mock('../../src/modules/whatsapp', () => {
  const wrap: Record<string, any> = {};
  for (const k of Object.keys(m)) wrap[k] = (...a: any[]) => (m as any)[k](...a);
  return wrap;
});

const mockVerifyTwilioSignature = vi.fn();
vi.mock('../../src/modules/whatsapp/twilio', async () => {
  const actual = await vi.importActual<any>('../../src/modules/whatsapp/twilio');
  return { ...actual, verifyTwilioSignature: (...a: any[]) => mockVerifyTwilioSignature(...a) };
});

const mockRedisSet = vi.fn();
vi.mock('../../src/queue', () => ({
  getRedisConnection: () => ({ set: (...a: any[]) => mockRedisSet(...a) }),
  rkey: (...parts: string[]) => parts.join(':'),
}));

const mockQueryOne = vi.fn();
vi.mock('../../src/db', () => ({
  queryOne: (...a: any[]) => mockQueryOne(...a),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import whatsappRoutes from '../../src/api/routes/whatsapp';
import { registerTwilioWhatsAppWebhook } from '../../src/api/twilio-webhook';

// ── Request helper ──

function makeRequest(
  app: express.Express,
  method: string,
  path: string,
  body?: string | Record<string, any>,
  contentType = 'application/json',
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('no address'));
        return;
      }
      const payload =
        body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path,
          method,
          headers: {
            'Content-Type': contentType,
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
            resolve({ status: res.statusCode || 0, body: parsed, raw: data });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ── Admin routes ──

function adminApp(role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.session = { user: { userId: 'U1', workspaceId: 'W1', platformRole: role } };
    req.sessionUser = req.session.user;
    next();
  });
  app.use('/whatsapp', whatsappRoutes);
  return app;
}

const CHANNEL = {
  id: 'wa-1',
  workspace_id: 'W1',
  name: 'Support',
  agent_id: 'agent-1',
  twilio_account_sid: 'AC0000001234',
  twilio_auth_token_encrypted: 'enc',
  twilio_auth_token_iv: 'iv',
  whatsapp_number: '+14155559999',
  enabled: true,
  created_by: 'U1',
  created_at: 'now',
  updated_at: 'now',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockQueryOne.mockResolvedValue({ name: 'Helper', model: 'claude-sonnet' });
  m.listAllowedNumbers.mockResolvedValue([]);
});

describe('WhatsApp admin routes', () => {
  it('blocks non-admins', async () => {
    const res = await makeRequest(adminApp('member'), 'GET', '/whatsapp/channels');
    expect(res.status).toBe(403);
  });

  it('lists channels without leaking the auth token', async () => {
    m.listWhatsAppChannels.mockResolvedValueOnce([CHANNEL]);
    m.listAllowedNumbers.mockResolvedValueOnce([{ id: 'n1', phone_number: '+14155550123', label: 'A' }]);
    const res = await makeRequest(adminApp(), 'GET', '/whatsapp/channels');
    expect(res.status).toBe(200);
    expect(res.raw).not.toContain('enc'); // encrypted token never serialised
    expect(res.raw).not.toContain('twilio_auth_token');
    expect(res.body[0]).toMatchObject({
      id: 'wa-1',
      whatsappNumber: '+14155559999',
      authTokenConfigured: true,
      accountSidMasked: '••••1234',
      allowedCount: 1,
    });
  });

  it('creates a channel', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'agent-1' }) // agent check
      .mockResolvedValueOnce({ name: 'Helper', model: 'claude-sonnet' }); // shape
    m.createWhatsAppChannel.mockResolvedValueOnce(CHANNEL);
    const res = await makeRequest(adminApp(), 'POST', '/whatsapp/channels', {
      name: 'Support',
      agentId: 'agent-1',
      accountSid: 'AC123',
      authToken: 'tok',
      whatsappNumber: '+14155559999',
      allowedNumbers: [{ number: '+14155550123' }],
    });
    expect(res.status).toBe(201);
    expect(m.createWhatsAppChannel).toHaveBeenCalled();
  });

  it('rejects creation with missing fields', async () => {
    const res = await makeRequest(adminApp(), 'POST', '/whatsapp/channels', { name: 'Support' });
    expect(res.status).toBe(400);
  });

  it('rejects creation with an unknown agent', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const res = await makeRequest(adminApp(), 'POST', '/whatsapp/channels', {
      name: 'Support',
      agentId: 'ghost',
      accountSid: 'AC',
      authToken: 'tok',
      whatsappNumber: '+14155559999',
    });
    expect(res.status).toBe(400);
  });

  it('surfaces an invalid phone number as a 400', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'agent-1' });
    m.createWhatsAppChannel.mockRejectedValueOnce(new Error('"bad" is not a valid international phone number'));
    const res = await makeRequest(adminApp(), 'POST', '/whatsapp/channels', {
      name: 'Support',
      agentId: 'agent-1',
      accountSid: 'AC',
      authToken: 'tok',
      whatsappNumber: 'bad',
    });
    expect(res.status).toBe(400);
  });

  it('updates a channel and replaces its allowlist', async () => {
    m.getWhatsAppChannel.mockResolvedValueOnce(CHANNEL);
    m.updateWhatsAppChannel.mockResolvedValueOnce({ ...CHANNEL, enabled: false });
    const res = await makeRequest(adminApp(), 'PATCH', '/whatsapp/channels/wa-1', {
      enabled: false,
      allowedNumbers: [{ number: '+14155550123' }],
    });
    expect(res.status).toBe(200);
    expect(m.replaceAllowedNumbers).toHaveBeenCalledWith('wa-1', [{ number: '+14155550123', label: null }]);
  });

  it('returns 404 updating an unknown channel', async () => {
    m.getWhatsAppChannel.mockResolvedValueOnce(undefined);
    const res = await makeRequest(adminApp(), 'PATCH', '/whatsapp/channels/ghost', { name: 'X' });
    expect(res.status).toBe(404);
  });

  it('deletes a channel', async () => {
    m.getWhatsAppChannel.mockResolvedValueOnce(CHANNEL);
    const res = await makeRequest(adminApp(), 'DELETE', '/whatsapp/channels/wa-1');
    expect(res.status).toBe(204);
    expect(m.deleteWhatsAppChannel).toHaveBeenCalledWith('W1', 'wa-1');
  });

  it('lists a channel allowed numbers', async () => {
    m.getWhatsAppChannel.mockResolvedValueOnce(CHANNEL);
    m.listAllowedNumbers.mockResolvedValueOnce([{ id: 'n1', phone_number: '+14155550123', label: null }]);
    const res = await makeRequest(adminApp(), 'GET', '/whatsapp/channels/wa-1/numbers');
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ id: 'n1', number: '+14155550123', label: null });
  });
});

// ── Inbound webhook ──

function webhookApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  registerTwilioWhatsAppWebhook(app);
  return app;
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

const INBOUND = {
  From: 'whatsapp:+14155550123',
  To: 'whatsapp:+14155559999',
  Body: 'hello agent',
  MessageSid: 'SM-inbound-1',
};

beforeEach(() => {
  mockVerifyTwilioSignature.mockReturnValue(true);
  mockRedisSet.mockResolvedValue('OK');
  m.decryptAuthToken.mockReturnValue('auth-token');
  m.getOrCreateSession.mockResolvedValue('sess-1');
  m.isNumberAllowed.mockResolvedValue(true);
  m.dispatchWhatsAppMessage.mockResolvedValue({ traceId: 'trace-1' });
});

describe('Twilio WhatsApp inbound webhook', () => {
  it('ignores a message to an unknown number with 200 empty TwiML', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(undefined);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(res.raw).toContain('<Response>');
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('ignores a message to a disabled channel', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce({ ...CHANNEL, enabled: false });
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('rejects a forged signature with 403', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    mockVerifyTwilioSignature.mockReturnValueOnce(false);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(403);
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('does not dispatch a message from a non-allowlisted number', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    m.isNumberAllowed.mockResolvedValueOnce(false);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('dispatches a valid inbound message', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).toHaveBeenCalledTimes(1);
    const [, sessionId, text, opts] = m.dispatchWhatsAppMessage.mock.calls[0];
    expect(sessionId).toBe('sess-1');
    expect(text).toBe('hello agent');
    expect(opts.replyToMessageId).toBeNull();
  });

  it('does not double-dispatch a duplicate MessageSid', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    mockRedisSet.mockResolvedValueOnce(null); // dedup key already set
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp', form(INBOUND),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('passes the quoted message as replyToMessageId for a WhatsApp reply', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    m.getMessageByTwilioSid.mockResolvedValueOnce({ id: 'm-quoted', session_id: 'sess-1' });
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp',
      form({ ...INBOUND, MessageSid: 'SM-reply', OriginalRepliedMessageSid: 'SM-old' }),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage.mock.calls[0][3].replyToMessageId).toBe('m-quoted');
  });

  it('falls back to a normal dispatch when the quoted SID is unknown', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    m.getMessageByTwilioSid.mockResolvedValueOnce(undefined);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp',
      form({ ...INBOUND, MessageSid: 'SM-reply2', OriginalRepliedMessageSid: 'SM-unknown' }),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(m.dispatchWhatsAppMessage.mock.calls[0][3].replyToMessageId).toBeNull();
  });

  it('ignores an empty (media-only) message body', async () => {
    m.getWhatsAppChannelByNumber.mockResolvedValueOnce(CHANNEL);
    const res = await makeRequest(
      webhookApp(), 'POST', '/webhooks/twilio/whatsapp',
      form({ ...INBOUND, Body: '' }),
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    expect(m.dispatchWhatsAppMessage).not.toHaveBeenCalled();
  });
});
