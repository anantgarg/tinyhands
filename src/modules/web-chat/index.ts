import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { config } from '../../config';
import { encrypt, decrypt } from '../connections/crypto';
import { enqueueRun } from '../../queue';
import { logger } from '../../utils/logger';
import type { JobData, WebChatChannel, WebChatMessage, WebChatMessageRole } from '../../types';

// ── Web Chat module ──
// CRUD for web chat channels plus the runtime path that turns a visitor
// message into an agent run. Runs are enqueued with empty channelId/threadTs
// so the execution module skips every Slack call; the reply is read back from
// run_history by trace_id.

const HISTORY_LIMIT = 12;

// ── Helpers ──

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'web-chat';
}

async function uniqueSlug(workspaceId: string, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  // Collisions are rare — a short bounded loop is fine.
  while (
    await queryOne('SELECT 1 FROM web_chat_channels WHERE workspace_id = $1 AND slug = $2', [workspaceId, candidate])
  ) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

function generateToken(): string {
  return randomBytes(18).toString('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Visitor session token ──
// After a successful username/password login the server issues a signed,
// httpOnly cookie scoped to one public token. It is verified on every
// subsequent message/poll request — no dashboard or Slack session involved.

const CHAT_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Cookie name scoped to a single web chat so two chats can be open at once. */
export function chatCookieName(token: string): string {
  return `wc_${token}`;
}

export function signChatSession(token: string): string {
  const payload = { token, expiresAt: Date.now() + CHAT_SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', config.server.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyChatSession(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const [body, sig] = value.split('.');
  if (!body || !sig) return false;
  const expected = createHmac('sha256', config.server.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.token !== token) return false;
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Channel CRUD ──

export async function listWebChats(workspaceId: string): Promise<WebChatChannel[]> {
  return query<WebChatChannel>(
    'SELECT * FROM web_chat_channels WHERE workspace_id = $1 ORDER BY created_at DESC',
    [workspaceId],
  );
}

export async function getWebChat(workspaceId: string, id: string): Promise<WebChatChannel | undefined> {
  return queryOne<WebChatChannel>(
    'SELECT * FROM web_chat_channels WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  );
}

export async function getWebChatByToken(token: string): Promise<WebChatChannel | undefined> {
  return queryOne<WebChatChannel>('SELECT * FROM web_chat_channels WHERE public_token = $1', [token]);
}

/** Decrypt the stored visitor password — used so an admin can re-share it. */
export function decryptWebChatPassword(channel: WebChatChannel): string {
  return decrypt(channel.auth_password_encrypted, channel.auth_password_iv);
}

export async function createWebChat(
  workspaceId: string,
  input: { name: string; agentId: string; username: string; password: string; createdBy?: string | null },
): Promise<WebChatChannel> {
  const id = uuid();
  const slug = await uniqueSlug(workspaceId, input.name);
  const token = generateToken();
  const { encrypted, iv } = encrypt(input.password);

  await execute(
    `INSERT INTO web_chat_channels
       (id, workspace_id, name, slug, agent_id, auth_username, auth_password_encrypted,
        auth_password_iv, public_token, enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10)`,
    [id, workspaceId, input.name, slug, input.agentId, input.username, encrypted, iv, token, input.createdBy ?? null],
  );

  logger.info('Web chat created', { workspaceId, webChatId: id, agentId: input.agentId });
  const created = await getWebChat(workspaceId, id);
  if (!created) throw new Error('Failed to load created web chat');
  return created;
}

export async function updateWebChat(
  workspaceId: string,
  id: string,
  fields: { name?: string; agentId?: string; username?: string; password?: string; enabled?: boolean },
): Promise<WebChatChannel | undefined> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (fields.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(fields.name);
  }
  if (fields.agentId !== undefined) {
    sets.push(`agent_id = $${idx++}`);
    values.push(fields.agentId);
  }
  if (fields.username !== undefined) {
    sets.push(`auth_username = $${idx++}`);
    values.push(fields.username);
  }
  if (fields.password !== undefined && fields.password !== '') {
    const { encrypted, iv } = encrypt(fields.password);
    sets.push(`auth_password_encrypted = $${idx++}`);
    values.push(encrypted);
    sets.push(`auth_password_iv = $${idx++}`);
    values.push(iv);
  }
  if (fields.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(fields.enabled);
  }

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    values.push(workspaceId, id);
    await execute(
      `UPDATE web_chat_channels SET ${sets.join(', ')} WHERE workspace_id = $${idx++} AND id = $${idx}`,
      values,
    );
  }

  return getWebChat(workspaceId, id);
}

export async function deleteWebChat(workspaceId: string, id: string): Promise<void> {
  await execute('DELETE FROM web_chat_channels WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
  logger.info('Web chat deleted', { workspaceId, webChatId: id });
}

/**
 * Verify a visitor credential against a web chat by its public token.
 * Returns the channel on success, null otherwise. Disabled channels never
 * authenticate.
 */
export async function verifyWebChatCredential(
  token: string,
  username: string,
  password: string,
): Promise<WebChatChannel | null> {
  const channel = await getWebChatByToken(token);
  if (!channel || !channel.enabled) return null;
  let storedPassword: string;
  try {
    storedPassword = decryptWebChatPassword(channel);
  } catch (err: any) {
    logger.error('Web chat password decrypt failed', { webChatId: channel.id, error: err.message });
    return null;
  }
  const userOk = constantTimeEquals(username, channel.auth_username);
  const passOk = constantTimeEquals(password, storedPassword);
  return userOk && passOk ? channel : null;
}

// ── Sessions & messages ──

export async function createSession(channelId: string): Promise<string> {
  const id = uuid();
  await execute('INSERT INTO web_chat_sessions (id, channel_id) VALUES ($1, $2)', [id, channelId]);
  return id;
}

export async function sessionBelongsToChannel(sessionId: string, channelId: string): Promise<boolean> {
  const row = await queryOne('SELECT 1 FROM web_chat_sessions WHERE id = $1 AND channel_id = $2', [
    sessionId,
    channelId,
  ]);
  return !!row;
}

export async function appendMessage(
  sessionId: string,
  role: WebChatMessageRole,
  content: string,
  traceId?: string | null,
): Promise<void> {
  await execute(
    'INSERT INTO web_chat_messages (id, session_id, role, content, trace_id) VALUES ($1, $2, $3, $4, $5)',
    [uuid(), sessionId, role, content, traceId ?? null],
  );
  await execute('UPDATE web_chat_sessions SET last_active_at = NOW() WHERE id = $1', [sessionId]);
}

export async function getSessionMessages(sessionId: string): Promise<WebChatMessage[]> {
  return query<WebChatMessage>(
    'SELECT * FROM web_chat_messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId],
  );
}

/** Has the assistant reply for this run already been recorded? */
export async function hasAssistantMessage(sessionId: string, traceId: string): Promise<boolean> {
  const row = await queryOne(
    "SELECT 1 FROM web_chat_messages WHERE session_id = $1 AND trace_id = $2 AND role = 'assistant'",
    [sessionId, traceId],
  );
  return !!row;
}

// ── Dispatch a visitor message as an agent run ──

/**
 * Persist the visitor message, build a run input that carries the recent
 * session history for context, and enqueue an agent run. The run has no Slack
 * channel — the reply is polled back from run_history by trace_id.
 */
export async function dispatchWebChatMessage(
  channel: WebChatChannel,
  sessionId: string,
  text: string,
): Promise<{ traceId: string }> {
  // Fetch history BEFORE persisting the new message so it isn't double-counted.
  const history = await getSessionMessages(sessionId);
  await appendMessage(sessionId, 'user', text);

  let input = text;
  if (history.length > 0) {
    const recent = history.slice(-HISTORY_LIMIT);
    const transcript = recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    input = `<conversation_history>\n${transcript}\n</conversation_history>\n\n<current_message>\n${text}\n</current_message>`;
  }

  const traceId = uuid();
  const jobData: JobData = {
    workspaceId: channel.workspace_id,
    agentId: channel.agent_id,
    channelId: '',
    threadTs: '',
    input,
    userId: null,
    traceId,
  };

  await enqueueRun(jobData, 'high');
  logger.info('Web chat message enqueued', { webChatId: channel.id, sessionId, traceId });
  return { traceId };
}
