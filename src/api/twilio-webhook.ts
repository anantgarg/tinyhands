import type { Application } from 'express';
import { logger } from '../utils/logger';

// ── Twilio WhatsApp inbound webhook ──
// Twilio POSTs inbound WhatsApp messages here (form-urlencoded). A WhatsApp
// message resolves to exactly one channel via its destination number, so there
// is no cross-workspace fan-out. We always answer 200 with empty TwiML for
// ignorable cases — Twilio retries on 4xx/5xx — and only 403 a forged
// signature. The agent reply is delivered asynchronously by the worker.

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

export function registerTwilioWhatsAppWebhook(app: Application): void {
  app.post('/webhooks/twilio/whatsapp', async (req: any, res) => {
    res.type('text/xml');
    try {
      const whatsapp = await import('../modules/whatsapp');
      const { stripWhatsAppPrefix, parseE164, verifyTwilioSignature } = await import(
        '../modules/whatsapp/twilio'
      );

      const body = (req.body ?? {}) as Record<string, string>;
      const toRaw = String(body.To ?? '');
      const fromRaw = String(body.From ?? '');
      const text = String(body.Body ?? '').trim();
      const messageSid = String(body.MessageSid ?? body.SmsMessageSid ?? '');

      // 1. Identify the channel by the number the message was sent TO.
      let toNumber: string;
      try {
        toNumber = parseE164(stripWhatsAppPrefix(toRaw));
      } catch {
        res.status(200).send(EMPTY_TWIML);
        return;
      }
      const channel = await whatsapp.getWhatsAppChannelByNumber(toNumber);
      if (!channel || !channel.enabled) {
        res.status(200).send(EMPTY_TWIML);
        return;
      }

      // 2. Verify the Twilio request signature with the channel's auth token.
      let authToken: string;
      try {
        authToken = whatsapp.decryptAuthToken(channel);
      } catch {
        res.status(200).send(EMPTY_TWIML);
        return;
      }
      const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      if (!verifyTwilioSignature(authToken, fullUrl, body, req.headers['x-twilio-signature'] as string)) {
        res.status(403).send(EMPTY_TWIML);
        return;
      }

      // 3. Check the sender against the channel allowlist.
      let fromNumber: string;
      try {
        fromNumber = parseE164(stripWhatsAppPrefix(fromRaw));
      } catch {
        res.status(200).send(EMPTY_TWIML);
        return;
      }
      if (!(await whatsapp.isNumberAllowed(channel.id, fromNumber))) {
        logger.info('WhatsApp message from non-allowlisted number ignored', {
          whatsappChannelId: channel.id,
        });
        res.status(200).send(EMPTY_TWIML);
        return;
      }

      // Ignore empty bodies (e.g. media-only messages — unsupported in v1).
      if (!text) {
        res.status(200).send(EMPTY_TWIML);
        return;
      }

      // 4. Deduplicate on MessageSid so Twilio retries don't double-run.
      if (messageSid) {
        const { getRedisConnection, rkey } = await import('../queue');
        const redis = getRedisConnection();
        const dedupKey = rkey(channel.workspace_id, 'whatsapp', 'msg', messageSid);
        const fresh = await redis.set(dedupKey, '1', 'EX', 300, 'NX');
        if (fresh === null) {
          res.status(200).send(EMPTY_TWIML);
          return;
        }
      }

      // 5. Resolve a quoted message (WhatsApp reply) and dispatch the run.
      const sessionId = await whatsapp.getOrCreateSession(channel.id, fromNumber);
      let replyToMessageId: string | null = null;
      const repliedSid = String(body.OriginalRepliedMessageSid ?? '');
      if (repliedSid) {
        const quoted = await whatsapp.getMessageByTwilioSid(repliedSid);
        if (quoted && quoted.session_id === sessionId) {
          replyToMessageId = quoted.id;
        }
      }
      await whatsapp.dispatchWhatsAppMessage(channel, sessionId, text, {
        twilioMessageSid: messageSid || null,
        replyToMessageId,
      });
      res.status(200).send(EMPTY_TWIML);
    } catch (err: any) {
      logger.error('Twilio WhatsApp webhook error', { error: err.message });
      // Still answer 200 — a 5xx makes Twilio retry a message we may have queued.
      res.status(200).send(EMPTY_TWIML);
    }
  });
}
