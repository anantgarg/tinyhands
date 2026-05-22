import { createHmac, timingSafeEqual } from 'crypto';
import { request as httpsRequest } from 'https';

// ── Twilio WhatsApp client ──
// A thin client over Twilio's REST API and request-signature scheme, built on
// Node built-ins only — no twilio npm package. Used for verifying inbound
// webhooks and sending outbound WhatsApp replies.

const REQUEST_TIMEOUT_MS = 30_000;
/** WhatsApp caps a single message body; long replies are split into chunks. */
export const WHATSAPP_BODY_LIMIT = 1600;

// ── Phone-number normalisation ──
// Every stored number is E.164: a single leading '+', then 8–15 digits. Twilio
// delivers From/To as 'whatsapp:+…' — strip that prefix before comparison.

/** Strip a leading 'whatsapp:' channel prefix if present. */
export function stripWhatsAppPrefix(raw: string): string {
  return raw.replace(/^whatsapp:/i, '').trim();
}

/**
 * Normalise a raw phone string to E.164. Strips spaces, dashes, parentheses and
 * dots, collapses a leading '00' international prefix to '+', and validates the
 * result. Throws on anything that is not a plausible E.164 number.
 */
export function parseE164(raw: string): string {
  if (!raw) throw new Error('Phone number is required');
  let s = stripWhatsAppPrefix(String(raw)).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) s = `+${s}`;
  if (!/^\+[1-9]\d{7,14}$/.test(s)) {
    throw new Error(`"${raw}" is not a valid international phone number`);
  }
  return s;
}

/**
 * Build an E.164 number from a separate ISD/country code and a national number.
 * Both halves are stripped of formatting; the ISD code must be 1–4 digits.
 */
export function normalizeE164(isdCode: string, nationalNumber: string): string {
  const isd = String(isdCode ?? '').replace(/[\s\-().+]/g, '');
  const national = String(nationalNumber ?? '').replace(/[\s\-().]/g, '');
  if (!/^[1-9]\d{0,3}$/.test(isd)) {
    throw new Error(`"${isdCode}" is not a valid country code`);
  }
  if (!/^\d+$/.test(national) || national.length === 0) {
    throw new Error(`"${nationalNumber}" is not a valid phone number`);
  }
  return parseE164(`+${isd}${national}`);
}

// ── Request signature verification ──

/**
 * Verify Twilio's X-Twilio-Signature for an inbound webhook. Twilio signs the
 * full request URL with every POSTed param appended in key-sorted order
 * (key immediately followed by value), HMAC-SHA1 with the auth token, base64.
 */
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
  signatureHeader: string | undefined,
): boolean {
  if (!authToken || !signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? '');
  }
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Outbound messages ──

/** Split a long body into WhatsApp-sized chunks, preferring line breaks. */
export function chunkBody(body: string, limit = WHATSAPP_BODY_LIMIT): string[] {
  if (body.length <= limit) return [body];
  const chunks: string[] = [];
  let remaining = body;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n', limit);
    if (cut <= 0) cut = remaining.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  /** The Twilio WhatsApp sender number in E.164 (no 'whatsapp:' prefix). */
  whatsappNumber: string;
}

interface TwilioMessageResponse {
  sid: string;
}

function postForm(
  url: string,
  authHeader: string,
  form: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(form).toString();
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: authHeader,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Twilio request timed out'));
    });
    req.write(payload);
    req.end();
  });
}

/**
 * Send a WhatsApp message via Twilio. Long bodies are split into multiple
 * messages; the SID of the first message is returned (it is what a later
 * visitor reply will quote).
 */
export async function sendWhatsAppMessage(
  creds: TwilioCredentials,
  toNumber: string,
  body: string,
): Promise<{ sid: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const authHeader = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`;
  const chunks = chunkBody(body || '…');

  let firstSid = '';
  for (const chunk of chunks) {
    const { status, body: respBody } = await postForm(url, authHeader, {
      From: `whatsapp:${creds.whatsappNumber}`,
      To: `whatsapp:${stripWhatsAppPrefix(toNumber)}`,
      Body: chunk,
    });
    if (status < 200 || status >= 300) {
      throw new Error(`Twilio send failed (${status}): ${respBody}`);
    }
    const parsed = JSON.parse(respBody) as TwilioMessageResponse;
    if (!firstSid) firstSid = parsed.sid;
  }
  return { sid: firstSid };
}
