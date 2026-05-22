import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockClientQuery = vi.fn();
const mockEnqueueRun = vi.fn();
const mockSendWhatsAppMessage = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  execute: (...a: any[]) => mockExecute(...a),
  withTransaction: async (fn: any) => fn({ query: mockClientQuery }),
}));

vi.mock('../../src/queue', () => ({
  enqueueRun: (...a: any[]) => mockEnqueueRun(...a),
}));

vi.mock('../../src/config', () => ({
  config: {
    encryption: { key: 'test-encryption-key-at-least-32-chars-long' },
    server: { sessionSecret: 'test-session-secret' },
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Keep real phone-number helpers; stub the network send.
vi.mock('../../src/modules/whatsapp/twilio', async () => {
  const actual = await vi.importActual<any>('../../src/modules/whatsapp/twilio');
  return { ...actual, sendWhatsAppMessage: (...a: any[]) => mockSendWhatsAppMessage(...a) };
});

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}));

import {
  decryptAuthToken,
  listWhatsAppChannels,
  getWhatsAppChannelByNumber,
  createWhatsAppChannel,
  updateWhatsAppChannel,
  deleteWhatsAppChannel,
  listAllowedNumbers,
  addAllowedNumber,
  removeAllowedNumber,
  replaceAllowedNumbers,
  isNumberAllowed,
  getOrCreateSession,
  appendMessage,
  getSessionMessages,
  getMessageByTwilioSid,
  getReplyThreadContext,
  hasAssistantMessage,
  dispatchWhatsAppMessage,
  findRunContext,
  deliverWhatsAppReply,
} from '../../src/modules/whatsapp';
import { encrypt } from '../../src/modules/connections/crypto';
import type { WhatsAppChannel, WhatsAppMessage } from '../../src/types';

function makeChannel(overrides: Partial<WhatsAppChannel> = {}): WhatsAppChannel {
  const { encrypted, iv } = encrypt('twilio-secret-token');
  return {
    id: 'wa-1',
    workspace_id: 'W1',
    name: 'Support WhatsApp',
    agent_id: 'agent-1',
    twilio_account_sid: 'AC123',
    twilio_auth_token_encrypted: encrypted,
    twilio_auth_token_iv: iv,
    whatsapp_number: '+14155559999',
    enabled: true,
    created_by: 'user-1',
    created_at: '2026-05-22T00:00:00Z',
    updated_at: '2026-05-22T00:00:00Z',
    ...overrides,
  };
}

function msg(over: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: 'm',
    session_id: 'sess-1',
    role: 'user',
    content: '',
    trace_id: null,
    twilio_message_sid: null,
    reply_to_message_id: null,
    created_at: '2026-05-22T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});

// ── Auth token ──

describe('whatsapp auth token', () => {
  it('round-trips the Twilio auth token through encryption', () => {
    expect(decryptAuthToken(makeChannel())).toBe('twilio-secret-token');
  });
});

// ── Channel CRUD ──

describe('whatsapp channel CRUD', () => {
  it('lists channels for a workspace', async () => {
    mockQuery.mockResolvedValueOnce([makeChannel()]);
    const list = await listWhatsAppChannels('W1');
    expect(list).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toContain('FROM whatsapp_channels');
  });

  it('resolves a channel by its WhatsApp number', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await getWhatsAppChannelByNumber('+14155559999');
    expect(mockQueryOne.mock.calls[0][1]).toEqual(['+14155559999']);
  });

  it('creates a channel with an encrypted token and normalised numbers', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel()); // getWhatsAppChannel after insert
    await createWhatsAppChannel('W1', {
      name: 'Support WhatsApp',
      agentId: 'agent-1',
      accountSid: 'AC123',
      authToken: 'twilio-secret-token',
      whatsappNumber: '+1 (415) 555-9999',
      allowedNumbers: [{ number: '+1 415 555 0123', label: 'Alice' }],
      createdBy: 'user-1',
    });
    const channelInsert = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('INTO whatsapp_channels'));
    expect(channelInsert).toBeTruthy();
    // The raw auth token must never be stored.
    expect(channelInsert![1]).not.toContain('twilio-secret-token');
    // The sender number is normalised to E.164.
    expect(channelInsert![1]).toContain('+14155559999');
    const allowedInsert = mockClientQuery.mock.calls.find((c) =>
      String(c[0]).includes('INTO whatsapp_allowed_numbers'),
    );
    expect(allowedInsert![1]).toContain('+14155550123');
  });

  it('rejects an invalid sender number on create', async () => {
    await expect(
      createWhatsAppChannel('W1', {
        name: 'X',
        agentId: 'agent-1',
        accountSid: 'AC',
        authToken: 'tok',
        whatsappNumber: 'not-a-number',
      }),
    ).rejects.toThrow();
  });

  it('updates name and re-encrypts the token only when supplied', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWhatsAppChannel('W1', 'wa-1', { name: 'Renamed', authToken: 'new-token' });
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('name =');
    expect(sql).toContain('twilio_auth_token_encrypted =');
    expect(params).not.toContain('new-token');
  });

  it('ignores a blank auth token on update', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWhatsAppChannel('W1', 'wa-1', { name: 'X', authToken: '' });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).not.toContain('twilio_auth_token_encrypted');
  });

  it('normalises the WhatsApp number on update', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWhatsAppChannel('W1', 'wa-1', { whatsappNumber: '+1 415-555-9999' });
    const [, params] = mockExecute.mock.calls[0];
    expect(params).toContain('+14155559999');
  });

  it('skips the UPDATE when no fields are supplied', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWhatsAppChannel('W1', 'wa-1', {});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('deletes a channel scoped to its workspace', async () => {
    await deleteWhatsAppChannel('W1', 'wa-1');
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('DELETE FROM whatsapp_channels');
    expect(params).toEqual(['W1', 'wa-1']);
  });
});

// ── Allowed numbers ──

describe('whatsapp allowed numbers', () => {
  it('lists allowed numbers for a channel', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'n1', phone_number: '+14155550123' }]);
    const list = await listAllowedNumbers('wa-1');
    expect(list).toHaveLength(1);
  });

  it('normalises a number when adding it', async () => {
    await addAllowedNumber('wa-1', '+1 (415) 555-0123', 'Alice');
    const [, params] = mockExecute.mock.calls[0];
    expect(params).toContain('+14155550123');
    expect(params).toContain('Alice');
  });

  it('rejects an invalid number', async () => {
    await expect(addAllowedNumber('wa-1', 'garbage')).rejects.toThrow();
  });

  it('removes an allowed number scoped to its channel', async () => {
    await removeAllowedNumber('wa-1', 'n1');
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('DELETE FROM whatsapp_allowed_numbers');
    expect(params).toEqual(['wa-1', 'n1']);
  });

  it('replaces the whole allowlist atomically', async () => {
    await replaceAllowedNumbers('wa-1', [
      { number: '+14155550123' },
      { number: '+442079460958', label: 'London' },
    ]);
    const del = mockClientQuery.mock.calls.find((c) => String(c[0]).includes('DELETE FROM whatsapp_allowed_numbers'));
    expect(del).toBeTruthy();
    const inserts = mockClientQuery.mock.calls.filter((c) =>
      String(c[0]).includes('INTO whatsapp_allowed_numbers'),
    );
    expect(inserts).toHaveLength(2);
  });

  it('reports whether a number is on the allowlist', async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: 1 });
    expect(await isNumberAllowed('wa-1', '+14155550123')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await isNumberAllowed('wa-1', '+14155559876')).toBe(false);
  });
});

// ── Sessions & messages ──

describe('whatsapp sessions & messages', () => {
  it('reuses an existing session for a visitor', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'sess-existing' });
    const id = await getOrCreateSession('wa-1', '+14155550123');
    expect(id).toBe('sess-existing');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('creates a session when the visitor has none', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const id = await getOrCreateSession('wa-1', '+14155550123');
    expect(typeof id).toBe('string');
    expect(mockExecute.mock.calls[0][0]).toContain('INSERT INTO whatsapp_sessions');
  });

  it('records a message with its Twilio SID and reply link', async () => {
    await appendMessage('sess-1', 'user', 'hi', {
      traceId: 't1',
      twilioMessageSid: 'SM1',
      replyToMessageId: 'm0',
    });
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('INSERT INTO whatsapp_messages');
    expect(params).toContain('SM1');
    expect(params).toContain('m0');
    expect(mockExecute.mock.calls[1][0]).toContain('last_active_at');
  });

  it('reads session messages in order', async () => {
    mockQuery.mockResolvedValueOnce([msg({ id: 'm1' })]);
    await getSessionMessages('sess-1');
    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at ASC');
  });

  it('resolves a message by its Twilio SID', async () => {
    mockQueryOne.mockResolvedValueOnce(msg({ id: 'm1', twilio_message_sid: 'SM9' }));
    const found = await getMessageByTwilioSid('SM9');
    expect(found?.id).toBe('m1');
  });

  it('detects whether an assistant reply was already recorded', async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: 1 });
    expect(await hasAssistantMessage('sess-1', 't1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await hasAssistantMessage('sess-1', 't2')).toBe(false);
  });
});

// ── Reply thread context ──

describe('getReplyThreadContext', () => {
  const thread = [
    msg({ id: 'm1', role: 'user', content: 'first question' }),
    msg({ id: 'm2', role: 'assistant', content: 'first answer' }),
    msg({ id: 'm3', role: 'user', content: 'second question' }),
    msg({ id: 'm4', role: 'assistant', content: 'second answer' }),
  ];

  it('returns the whole conversation when quoting the first message', async () => {
    mockQuery.mockResolvedValueOnce(thread);
    const ctx = await getReplyThreadContext('sess-1', 'm1');
    expect(ctx.map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('returns only the tail when quoting a later message', async () => {
    mockQuery.mockResolvedValueOnce(thread);
    const ctx = await getReplyThreadContext('sess-1', 'm3');
    expect(ctx.map((m) => m.id)).toEqual(['m3', 'm4']);
  });

  it('returns nothing when the quoted message is not in the session', async () => {
    mockQuery.mockResolvedValueOnce(thread);
    const ctx = await getReplyThreadContext('sess-1', 'unknown');
    expect(ctx).toEqual([]);
  });
});

// ── Dispatch ──

describe('dispatchWhatsAppMessage', () => {
  it('enqueues a run with no Slack channel', async () => {
    mockQuery.mockResolvedValueOnce([]); // no history
    const { traceId } = await dispatchWhatsAppMessage(makeChannel(), 'sess-1', 'hello');
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const [jobData, priority] = mockEnqueueRun.mock.calls[0];
    expect(jobData.channelId).toBe('');
    expect(jobData.threadTs).toBe('');
    expect(jobData.userId).toBeNull();
    expect(jobData.agentId).toBe('agent-1');
    expect(jobData.input).toBe('hello');
    expect(jobData.traceId).toBe(traceId);
    expect(priority).toBe('high');
  });

  it('prefixes recent session history for a plain message', async () => {
    mockQuery.mockResolvedValueOnce([
      msg({ id: 'm1', role: 'user', content: 'earlier' }),
      msg({ id: 'm2', role: 'assistant', content: 'reply' }),
    ]);
    await dispatchWhatsAppMessage(makeChannel(), 'sess-1', 'follow up');
    const [jobData] = mockEnqueueRun.mock.calls[0];
    expect(jobData.input).toContain('<conversation_history>');
    expect(jobData.input).toContain('User: earlier');
    expect(jobData.input).toContain('<current_message>\nfollow up');
  });

  it('uses the reply thread when a message is quoted', async () => {
    // getReplyThreadContext → getSessionMessages
    mockQuery.mockResolvedValueOnce([
      msg({ id: 'm1', role: 'user', content: 'q1' }),
      msg({ id: 'm2', role: 'assistant', content: 'a1' }),
      msg({ id: 'm3', role: 'user', content: 'q2' }),
    ]);
    await dispatchWhatsAppMessage(makeChannel(), 'sess-1', 'about a1?', { replyToMessageId: 'm2' });
    const [jobData] = mockEnqueueRun.mock.calls[0];
    expect(jobData.input).toContain('<reply_thread>');
    expect(jobData.input).toContain('Assistant: a1');
    expect(jobData.input).toContain('User: q2');
    expect(jobData.input).not.toContain('q1'); // before the quoted message
    expect(jobData.input).toContain('<current_message>\nabout a1?');
  });

  it('persists the inbound message with its trace id, SID and reply link', async () => {
    mockQuery.mockResolvedValueOnce([]); // no history
    await dispatchWhatsAppMessage(makeChannel(), 'sess-1', 'hi', {
      twilioMessageSid: 'SM-in',
      replyToMessageId: 'm2',
    });
    const insert = mockExecute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO whatsapp_messages'));
    expect(insert).toBeTruthy();
    expect(insert![1]).toContain('user');
    expect(insert![1]).toContain('SM-in');
    expect(insert![1]).toContain('m2');
  });
});

// ── Run context & reply delivery ──

describe('findRunContext', () => {
  it('returns null for a run that is not a WhatsApp run', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await findRunContext('trace-x')).toBeNull();
  });

  it('resolves the channel and session for a WhatsApp run', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ session_id: 'sess-1', visitor_number: '+14155550123', channel_id: 'wa-1' })
      .mockResolvedValueOnce(makeChannel());
    const ctx = await findRunContext('trace-1');
    expect(ctx?.channel.id).toBe('wa-1');
    expect(ctx?.session.visitor_number).toBe('+14155550123');
  });
});

describe('deliverWhatsAppReply', () => {
  it('does nothing for a non-WhatsApp run', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined); // findRunContext → no row
    await deliverWhatsAppReply('trace-x', 'output', true);
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('sends the reply over WhatsApp and records the assistant turn', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ session_id: 'sess-1', visitor_number: '+14155550123', channel_id: 'wa-1' })
      .mockResolvedValueOnce(makeChannel())
      .mockResolvedValueOnce(undefined); // hasAssistantMessage → not yet
    mockSendWhatsAppMessage.mockResolvedValueOnce({ sid: 'SM-out' });
    await deliverWhatsAppReply('trace-1', 'here is the answer', true);
    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockSendWhatsAppMessage.mock.calls[0][2]).toBe('here is the answer');
    const insert = mockExecute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO whatsapp_messages'));
    expect(insert![1]).toContain('assistant');
    expect(insert![1]).toContain('SM-out');
  });

  it('does not deliver twice for the same run', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ session_id: 'sess-1', visitor_number: '+14155550123', channel_id: 'wa-1' })
      .mockResolvedValueOnce(makeChannel())
      .mockResolvedValueOnce({ exists: 1 }); // hasAssistantMessage → already recorded
    await deliverWhatsAppReply('trace-1', 'answer', true);
    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('sends a canned error message when the run failed', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ session_id: 'sess-1', visitor_number: '+14155550123', channel_id: 'wa-1' })
      .mockResolvedValueOnce(makeChannel())
      .mockResolvedValueOnce(undefined);
    mockSendWhatsAppMessage.mockResolvedValueOnce({ sid: 'SM-err' });
    await deliverWhatsAppReply('trace-1', '', false);
    expect(mockSendWhatsAppMessage.mock.calls[0][2]).toMatch(/something went wrong/i);
  });
});
