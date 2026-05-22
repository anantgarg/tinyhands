import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import { encrypt, decrypt } from '../connections/crypto';
import { enqueueRun } from '../../queue';
import { logger } from '../../utils/logger';
import { parseE164 } from './twilio';
import type {
  JobData,
  WhatsAppChannel,
  WhatsAppAllowedNumber,
  WhatsAppMessage,
  WhatsAppMessageRole,
} from '../../types';

// ── WhatsApp module ──
// CRUD for WhatsApp channels (one per Twilio sender number) plus the runtime
// path that turns an inbound WhatsApp message into an agent run. Runs are
// enqueued with empty channelId/threadTs so the execution module skips every
// Slack call; the reply is pushed back to the visitor via Twilio when the run
// completes (see deliverWhatsAppReply).

const HISTORY_LIMIT = 12;

// ── Auth token ──

/** Decrypt the stored Twilio auth token — needed to call Twilio and verify signatures. */
export function decryptAuthToken(channel: WhatsAppChannel): string {
  return decrypt(channel.twilio_auth_token_encrypted, channel.twilio_auth_token_iv);
}

// ── Channel CRUD ──

export async function listWhatsAppChannels(workspaceId: string): Promise<WhatsAppChannel[]> {
  return query<WhatsAppChannel>(
    'SELECT * FROM whatsapp_channels WHERE workspace_id = $1 ORDER BY created_at DESC',
    [workspaceId],
  );
}

export async function getWhatsAppChannel(
  workspaceId: string,
  id: string,
): Promise<WhatsAppChannel | undefined> {
  return queryOne<WhatsAppChannel>(
    'SELECT * FROM whatsapp_channels WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  );
}

/** Resolve a channel by the Twilio sender number an inbound message was sent to. */
export async function getWhatsAppChannelByNumber(
  e164Number: string,
): Promise<WhatsAppChannel | undefined> {
  return queryOne<WhatsAppChannel>('SELECT * FROM whatsapp_channels WHERE whatsapp_number = $1', [
    e164Number,
  ]);
}

export interface CreateWhatsAppChannelInput {
  name: string;
  agentId: string;
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  allowedNumbers?: Array<{ number: string; label?: string | null }>;
  createdBy?: string | null;
}

export async function createWhatsAppChannel(
  workspaceId: string,
  input: CreateWhatsAppChannelInput,
): Promise<WhatsAppChannel> {
  const id = uuid();
  const whatsappNumber = parseE164(input.whatsappNumber);
  const { encrypted, iv } = encrypt(input.authToken);
  const allowed = (input.allowedNumbers ?? []).map((a) => ({
    number: parseE164(a.number),
    label: a.label ?? null,
  }));

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO whatsapp_channels
         (id, workspace_id, name, agent_id, twilio_account_sid, twilio_auth_token_encrypted,
          twilio_auth_token_iv, whatsapp_number, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9)`,
      [id, workspaceId, input.name, input.agentId, input.accountSid, encrypted, iv,
        whatsappNumber, input.createdBy ?? null],
    );
    for (const entry of allowed) {
      await client.query(
        `INSERT INTO whatsapp_allowed_numbers (id, channel_id, phone_number, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel_id, phone_number) DO NOTHING`,
        [uuid(), id, entry.number, entry.label],
      );
    }
  });

  logger.info('WhatsApp channel created', { workspaceId, whatsappChannelId: id, agentId: input.agentId });
  const created = await getWhatsAppChannel(workspaceId, id);
  if (!created) throw new Error('Failed to load created WhatsApp channel');
  return created;
}

export interface UpdateWhatsAppChannelFields {
  name?: string;
  agentId?: string;
  accountSid?: string;
  authToken?: string;
  whatsappNumber?: string;
  enabled?: boolean;
}

export async function updateWhatsAppChannel(
  workspaceId: string,
  id: string,
  fields: UpdateWhatsAppChannelFields,
): Promise<WhatsAppChannel | undefined> {
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
  if (fields.accountSid !== undefined) {
    sets.push(`twilio_account_sid = $${idx++}`);
    values.push(fields.accountSid);
  }
  if (fields.authToken !== undefined && fields.authToken !== '') {
    const { encrypted, iv } = encrypt(fields.authToken);
    sets.push(`twilio_auth_token_encrypted = $${idx++}`);
    values.push(encrypted);
    sets.push(`twilio_auth_token_iv = $${idx++}`);
    values.push(iv);
  }
  if (fields.whatsappNumber !== undefined) {
    sets.push(`whatsapp_number = $${idx++}`);
    values.push(parseE164(fields.whatsappNumber));
  }
  if (fields.enabled !== undefined) {
    sets.push(`enabled = $${idx++}`);
    values.push(fields.enabled);
  }

  if (sets.length > 0) {
    sets.push('updated_at = NOW()');
    values.push(workspaceId, id);
    await execute(
      `UPDATE whatsapp_channels SET ${sets.join(', ')} WHERE workspace_id = $${idx++} AND id = $${idx}`,
      values,
    );
  }

  return getWhatsAppChannel(workspaceId, id);
}

export async function deleteWhatsAppChannel(workspaceId: string, id: string): Promise<void> {
  await execute('DELETE FROM whatsapp_channels WHERE workspace_id = $1 AND id = $2', [workspaceId, id]);
  logger.info('WhatsApp channel deleted', { workspaceId, whatsappChannelId: id });
}

// ── Allowed numbers ──

export async function listAllowedNumbers(channelId: string): Promise<WhatsAppAllowedNumber[]> {
  return query<WhatsAppAllowedNumber>(
    'SELECT * FROM whatsapp_allowed_numbers WHERE channel_id = $1 ORDER BY created_at ASC',
    [channelId],
  );
}

export async function addAllowedNumber(
  channelId: string,
  rawNumber: string,
  label?: string | null,
): Promise<void> {
  const e164 = parseE164(rawNumber);
  await execute(
    `INSERT INTO whatsapp_allowed_numbers (id, channel_id, phone_number, label)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_id, phone_number) DO UPDATE SET label = EXCLUDED.label`,
    [uuid(), channelId, e164, label ?? null],
  );
}

export async function removeAllowedNumber(channelId: string, id: string): Promise<void> {
  await execute('DELETE FROM whatsapp_allowed_numbers WHERE channel_id = $1 AND id = $2', [
    channelId,
    id,
  ]);
}

/** Replace a channel's whole allowlist atomically — used by the edit modal. */
export async function replaceAllowedNumbers(
  channelId: string,
  numbers: Array<{ number: string; label?: string | null }>,
): Promise<void> {
  const normalised = numbers.map((n) => ({
    number: parseE164(n.number),
    label: n.label ?? null,
  }));
  await withTransaction(async (client) => {
    await client.query('DELETE FROM whatsapp_allowed_numbers WHERE channel_id = $1', [channelId]);
    for (const entry of normalised) {
      await client.query(
        `INSERT INTO whatsapp_allowed_numbers (id, channel_id, phone_number, label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (channel_id, phone_number) DO NOTHING`,
        [uuid(), channelId, entry.number, entry.label],
      );
    }
  });
}

/** Is this E.164 number on the channel's allowlist? */
export async function isNumberAllowed(channelId: string, e164: string): Promise<boolean> {
  const row = await queryOne(
    'SELECT 1 FROM whatsapp_allowed_numbers WHERE channel_id = $1 AND phone_number = $2',
    [channelId, e164],
  );
  return !!row;
}

// ── Sessions & messages ──

/** Find an existing conversation for a visitor, or start one. */
export async function getOrCreateSession(channelId: string, visitorNumber: string): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM whatsapp_sessions WHERE channel_id = $1 AND visitor_number = $2',
    [channelId, visitorNumber],
  );
  if (existing) return existing.id;
  const id = uuid();
  await execute(
    'INSERT INTO whatsapp_sessions (id, channel_id, visitor_number) VALUES ($1, $2, $3)',
    [id, channelId, visitorNumber],
  );
  return id;
}

export interface AppendMessageOptions {
  traceId?: string | null;
  twilioMessageSid?: string | null;
  replyToMessageId?: string | null;
}

/** Persist one turn and return its row id. */
export async function appendMessage(
  sessionId: string,
  role: WhatsAppMessageRole,
  content: string,
  options: AppendMessageOptions = {},
): Promise<string> {
  const id = uuid();
  await execute(
    `INSERT INTO whatsapp_messages
       (id, session_id, role, content, trace_id, twilio_message_sid, reply_to_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      sessionId,
      role,
      content,
      options.traceId ?? null,
      options.twilioMessageSid ?? null,
      options.replyToMessageId ?? null,
    ],
  );
  await execute('UPDATE whatsapp_sessions SET last_active_at = NOW() WHERE id = $1', [sessionId]);
  return id;
}

export async function getSessionMessages(sessionId: string): Promise<WhatsAppMessage[]> {
  return query<WhatsAppMessage>(
    'SELECT * FROM whatsapp_messages WHERE session_id = $1 ORDER BY created_at ASC',
    [sessionId],
  );
}

/** Resolve a quoted message back to its row, used to turn a Twilio reply SID into a turn. */
export async function getMessageByTwilioSid(
  twilioMessageSid: string,
): Promise<WhatsAppMessage | undefined> {
  return queryOne<WhatsAppMessage>(
    'SELECT * FROM whatsapp_messages WHERE twilio_message_sid = $1',
    [twilioMessageSid],
  );
}

/**
 * The full reply thread: every message in the session from the quoted message
 * forward, in order. This is what a Slack-style reply hands to the agent.
 */
export async function getReplyThreadContext(
  sessionId: string,
  fromMessageId: string,
): Promise<WhatsAppMessage[]> {
  const all = await getSessionMessages(sessionId);
  const startIdx = all.findIndex((m) => m.id === fromMessageId);
  if (startIdx === -1) return [];
  return all.slice(startIdx);
}

/** Has the assistant reply for this run already been recorded? */
export async function hasAssistantMessage(sessionId: string, traceId: string): Promise<boolean> {
  const row = await queryOne(
    "SELECT 1 FROM whatsapp_messages WHERE session_id = $1 AND trace_id = $2 AND role = 'assistant'",
    [sessionId, traceId],
  );
  return !!row;
}

// ── Dispatch an inbound message as an agent run ──

function renderTranscript(messages: WhatsAppMessage[]): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

export interface DispatchOptions {
  /** Twilio SID of the inbound message (recorded so a later reply can quote it). */
  twilioMessageSid?: string | null;
  /** Set when the visitor quoted an earlier message via WhatsApp's reply gesture. */
  replyToMessageId?: string | null;
}

/**
 * Persist the inbound visitor message, build a run input carrying conversation
 * context, and enqueue an agent run. The run has no Slack channel — the reply
 * is pushed back to the visitor by deliverWhatsAppReply when the run completes.
 *
 * Context selection mirrors Slack: a plain message gets the recent session
 * history; a message that quotes an earlier one gets the full reply thread
 * from the quoted message forward.
 */
export async function dispatchWhatsAppMessage(
  channel: WhatsAppChannel,
  sessionId: string,
  text: string,
  options: DispatchOptions = {},
): Promise<{ traceId: string }> {
  const traceId = uuid();

  // Fetch context BEFORE persisting the new message so it isn't double-counted.
  let input = text;
  if (options.replyToMessageId) {
    const thread = await getReplyThreadContext(sessionId, options.replyToMessageId);
    if (thread.length > 0) {
      input =
        `The person is replying to an earlier message in this conversation and asking a follow-up about it.\n\n` +
        `<reply_thread>\n${renderTranscript(thread)}\n</reply_thread>\n\n` +
        `<current_message>\n${text}\n</current_message>`;
    }
  } else {
    const history = await getSessionMessages(sessionId);
    if (history.length > 0) {
      const recent = history.slice(-HISTORY_LIMIT);
      input =
        `<conversation_history>\n${renderTranscript(recent)}\n</conversation_history>\n\n` +
        `<current_message>\n${text}\n</current_message>`;
    }
  }

  await appendMessage(sessionId, 'user', text, {
    traceId,
    twilioMessageSid: options.twilioMessageSid ?? null,
    replyToMessageId: options.replyToMessageId ?? null,
  });

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
  logger.info('WhatsApp message enqueued', { whatsappChannelId: channel.id, sessionId, traceId });
  return { traceId };
}

// ── Reply delivery (worker completion path) ──

export interface WhatsAppRunContext {
  channel: WhatsAppChannel;
  session: { id: string; visitor_number: string };
}

/**
 * Resolve whether a finished run belongs to a WhatsApp conversation. The trace
 * id is recorded on the inbound user message at dispatch time; from there we
 * reach the session and channel. Returns null for Slack / Web Chat runs.
 */
export async function findRunContext(traceId: string): Promise<WhatsAppRunContext | null> {
  const row = await queryOne<{
    session_id: string;
    visitor_number: string;
    channel_id: string;
  }>(
    `SELECT s.id AS session_id, s.visitor_number, s.channel_id
       FROM whatsapp_messages m
       JOIN whatsapp_sessions s ON s.id = m.session_id
      WHERE m.trace_id = $1 AND m.role = 'user'
      LIMIT 1`,
    [traceId],
  );
  if (!row) return null;
  const channel = await queryOne<WhatsAppChannel>('SELECT * FROM whatsapp_channels WHERE id = $1', [
    row.channel_id,
  ]);
  if (!channel) return null;
  return {
    channel,
    session: { id: row.session_id, visitor_number: row.visitor_number },
  };
}

/**
 * Push a finished run's reply back to the visitor over WhatsApp. A no-op for
 * runs that did not originate from a WhatsApp channel. The assistant turn is
 * recorded exactly once, with the outbound Twilio SID so a later reply quoting
 * this answer can be traced back to it.
 */
export async function deliverWhatsAppReply(
  traceId: string,
  output: string,
  ok: boolean,
): Promise<void> {
  const ctx = await findRunContext(traceId);
  if (!ctx) return; // Not a WhatsApp run.
  if (await hasAssistantMessage(ctx.session.id, traceId)) return; // Already delivered.

  const { sendWhatsAppMessage } = await import('./twilio');
  const body = ok
    ? output || 'Done.'
    : 'Sorry — something went wrong handling that. Please try again in a moment.';

  let authToken: string;
  try {
    authToken = decryptAuthToken(ctx.channel);
  } catch (err: any) {
    logger.error('WhatsApp auth token decrypt failed', {
      whatsappChannelId: ctx.channel.id,
      error: err.message,
    });
    return;
  }

  try {
    const { sid } = await sendWhatsAppMessage(
      {
        accountSid: ctx.channel.twilio_account_sid,
        authToken,
        whatsappNumber: ctx.channel.whatsapp_number,
      },
      ctx.session.visitor_number,
      body,
    );
    await appendMessage(ctx.session.id, 'assistant', body, { traceId, twilioMessageSid: sid });
    logger.info('WhatsApp reply delivered', { whatsappChannelId: ctx.channel.id, traceId });
  } catch (err: any) {
    logger.error('WhatsApp reply delivery failed', {
      whatsappChannelId: ctx.channel.id,
      traceId,
      error: err.message,
    });
  }
}
