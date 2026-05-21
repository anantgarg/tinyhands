import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockEnqueueRun = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/queue', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
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

let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `uuid-${++uuidCounter}`,
}));

import {
  createWebChat,
  updateWebChat,
  deleteWebChat,
  verifyWebChatCredential,
  decryptWebChatPassword,
  dispatchWebChatMessage,
  createSession,
  appendMessage,
  getSessionMessages,
  hasAssistantMessage,
  signChatSession,
  verifyChatSession,
  chatCookieName,
} from '../../src/modules/web-chat';
import { encrypt } from '../../src/modules/connections/crypto';
import type { WebChatChannel } from '../../src/types';

function makeChannel(overrides: Partial<WebChatChannel> = {}): WebChatChannel {
  const { encrypted, iv } = encrypt('s3cret-pass');
  return {
    id: 'wc-1',
    workspace_id: 'W1',
    name: 'Support Chat',
    slug: 'support-chat',
    agent_id: 'agent-1',
    auth_username: 'guest',
    auth_password_encrypted: encrypted,
    auth_password_iv: iv,
    public_token: 'tok-abc',
    enabled: true,
    created_by: 'user-1',
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
});

// ── Credential encryption & verification ──

describe('web chat credentials', () => {
  it('round-trips the visitor password through encryption', () => {
    const channel = makeChannel();
    expect(decryptWebChatPassword(channel)).toBe('s3cret-pass');
  });

  it('verifies a correct username and password', async () => {
    const channel = makeChannel();
    mockQueryOne.mockResolvedValueOnce(channel);
    const result = await verifyWebChatCredential('tok-abc', 'guest', 's3cret-pass');
    expect(result).toEqual(channel);
  });

  it('rejects a wrong password', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    const result = await verifyWebChatCredential('tok-abc', 'guest', 'wrong');
    expect(result).toBeNull();
  });

  it('rejects a wrong username', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    const result = await verifyWebChatCredential('tok-abc', 'intruder', 's3cret-pass');
    expect(result).toBeNull();
  });

  it('rejects a disabled web chat', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel({ enabled: false }));
    const result = await verifyWebChatCredential('tok-abc', 'guest', 's3cret-pass');
    expect(result).toBeNull();
  });

  it('rejects an unknown token', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const result = await verifyWebChatCredential('nope', 'guest', 's3cret-pass');
    expect(result).toBeNull();
  });

  it('rejects a channel whose stored password cannot be decrypted', async () => {
    mockQueryOne.mockResolvedValueOnce(
      makeChannel({ auth_password_encrypted: 'corrupt.data', auth_password_iv: 'zz' }),
    );
    const result = await verifyWebChatCredential('tok-abc', 'guest', 's3cret-pass');
    expect(result).toBeNull();
  });
});

// ── Channel CRUD ──

describe('web chat CRUD', () => {
  it('lists web chats for a workspace', async () => {
    mockQuery.mockResolvedValueOnce([makeChannel()]);
    const list = await import('../../src/modules/web-chat').then((m) => m.listWebChats('W1'));
    expect(list).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toContain('FROM web_chat_channels');
  });

  it('updates the agent and username fields', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWebChat('W1', 'wc-1', { agentId: 'agent-2', username: 'newguest' });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toContain('agent_id =');
    expect(sql).toContain('auth_username =');
  });

  it('skips the UPDATE when no fields are supplied', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWebChat('W1', 'wc-1', {});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('creates a web chat with an encrypted password and a unique slug', async () => {
    // uniqueSlug check → no collision; getWebChat after insert → the row.
    mockQueryOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce(makeChannel());
    await createWebChat('W1', {
      name: 'Support Chat',
      agentId: 'agent-1',
      username: 'guest',
      password: 's3cret-pass',
      createdBy: 'user-1',
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('INSERT INTO web_chat_channels');
    // The raw password must never be stored.
    expect(params).not.toContain('s3cret-pass');
  });

  it('appends a numeric suffix when the slug already exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ exists: 1 }) // support-chat taken
      .mockResolvedValueOnce(undefined) // support-chat-2 free
      .mockResolvedValueOnce(makeChannel());
    await createWebChat('W1', {
      name: 'Support Chat',
      agentId: 'agent-1',
      username: 'guest',
      password: 'pw',
    });
    const [, params] = mockExecute.mock.calls[0];
    expect(params[3]).toBe('support-chat-2');
  });

  it('updates only the provided fields', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWebChat('W1', 'wc-1', { name: 'Renamed', enabled: false });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toContain('name =');
    expect(sql).toContain('enabled =');
    expect(sql).not.toContain('auth_password_encrypted');
  });

  it('re-encrypts the password when one is supplied', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWebChat('W1', 'wc-1', { password: 'new-pass' });
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('auth_password_encrypted');
    expect(params).not.toContain('new-pass');
  });

  it('ignores a blank password on update', async () => {
    mockQueryOne.mockResolvedValueOnce(makeChannel());
    await updateWebChat('W1', 'wc-1', { name: 'X', password: '' });
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).not.toContain('auth_password_encrypted');
  });

  it('deletes a web chat scoped to its workspace', async () => {
    await deleteWebChat('W1', 'wc-1');
    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toContain('DELETE FROM web_chat_channels');
    expect(params).toEqual(['W1', 'wc-1']);
  });
});

// ── Sessions & dispatch ──

describe('web chat dispatch', () => {
  it('enqueues a run with no Slack channel', async () => {
    mockQuery.mockResolvedValueOnce([]); // no history
    const channel = makeChannel();
    const { traceId } = await dispatchWebChatMessage(channel, 'sess-1', 'hello');

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

  it('prefixes prior session history into the run input', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'm1', session_id: 'sess-1', role: 'user', content: 'first', trace_id: null, created_at: 'a' },
      { id: 'm2', session_id: 'sess-1', role: 'assistant', content: 'reply', trace_id: 't1', created_at: 'b' },
    ]);
    await dispatchWebChatMessage(makeChannel(), 'sess-1', 'follow up');
    const [jobData] = mockEnqueueRun.mock.calls[0];
    expect(jobData.input).toContain('<conversation_history>');
    expect(jobData.input).toContain('User: first');
    expect(jobData.input).toContain('Assistant: reply');
    expect(jobData.input).toContain('<current_message>\nfollow up');
  });

  it('persists the visitor message before enqueueing', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await dispatchWebChatMessage(makeChannel(), 'sess-1', 'hi there');
    const insert = mockExecute.mock.calls.find((c) => String(c[0]).includes('INSERT INTO web_chat_messages'));
    expect(insert).toBeTruthy();
    expect(insert![1]).toContain('user');
    expect(insert![1]).toContain('hi there');
  });

  it('confirms whether a session belongs to a channel', async () => {
    const { sessionBelongsToChannel } = await import('../../src/modules/web-chat');
    mockQueryOne.mockResolvedValueOnce({ exists: 1 });
    expect(await sessionBelongsToChannel('sess-1', 'wc-1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await sessionBelongsToChannel('sess-x', 'wc-1')).toBe(false);
  });

  it('creates a session row', async () => {
    const id = await createSession('wc-1');
    expect(typeof id).toBe('string');
    const [sql] = mockExecute.mock.calls[0];
    expect(sql).toContain('INSERT INTO web_chat_sessions');
  });

  it('records a message and bumps last_active_at', async () => {
    await appendMessage('sess-1', 'assistant', 'done', 'trace-1');
    expect(mockExecute.mock.calls[0][0]).toContain('INSERT INTO web_chat_messages');
    expect(mockExecute.mock.calls[1][0]).toContain('last_active_at');
  });

  it('reads session messages in order', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'm1' }]);
    const msgs = await getSessionMessages('sess-1');
    expect(msgs).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at ASC');
  });

  it('detects whether an assistant reply was already recorded', async () => {
    mockQueryOne.mockResolvedValueOnce({ exists: 1 });
    expect(await hasAssistantMessage('sess-1', 'trace-1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await hasAssistantMessage('sess-1', 'trace-2')).toBe(false);
  });
});

// ── Visitor session token ──

describe('web chat session token', () => {
  it('signs and verifies a token for the same web chat', () => {
    const value = signChatSession('tok-abc');
    expect(verifyChatSession(value, 'tok-abc')).toBe(true);
  });

  it('rejects a token signed for a different web chat', () => {
    const value = signChatSession('tok-abc');
    expect(verifyChatSession(value, 'tok-xyz')).toBe(false);
  });

  it('rejects a tampered or empty value', () => {
    expect(verifyChatSession(undefined, 'tok-abc')).toBe(false);
    expect(verifyChatSession('garbage', 'tok-abc')).toBe(false);
    const value = signChatSession('tok-abc');
    expect(verifyChatSession(value + 'x', 'tok-abc')).toBe(false);
  });

  it('rejects a correctly-signed token whose body is not valid JSON', async () => {
    const { createHmac } = await import('crypto');
    const body = Buffer.from('not-json{').toString('base64url');
    const sig = createHmac('sha256', 'test-session-secret').update(body).digest('base64url');
    expect(verifyChatSession(`${body}.${sig}`, 'tok-abc')).toBe(false);
  });

  it('rejects an expired token', async () => {
    const { createHmac } = await import('crypto');
    const body = Buffer.from(JSON.stringify({ token: 'tok-abc', expiresAt: Date.now() - 1000 })).toString(
      'base64url',
    );
    const sig = createHmac('sha256', 'test-session-secret').update(body).digest('base64url');
    expect(verifyChatSession(`${body}.${sig}`, 'tok-abc')).toBe(false);
  });

  it('scopes the cookie name to the public token', () => {
    expect(chatCookieName('tok-abc')).toBe('wc_tok-abc');
  });
});
