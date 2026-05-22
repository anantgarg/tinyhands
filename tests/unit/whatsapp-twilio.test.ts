import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { EventEmitter } from 'events';

// ── Mock the https module so sendWhatsAppMessage never hits the network ──

interface FakeResponse {
  status: number;
  body: string;
}
let fakeResponses: FakeResponse[] = [];
let capturedRequests: Array<{ options: any; payload: string }> = [];

vi.mock('https', () => ({
  request: (options: any, cb: (res: any) => void) => {
    const req = new EventEmitter() as any;
    let payload = '';
    req.write = (chunk: string) => {
      payload += chunk;
    };
    req.end = () => {
      capturedRequests.push({ options, payload });
      const fake = fakeResponses.shift() ?? { status: 201, body: '{"sid":"SMdefault"}' };
      const res = new EventEmitter() as any;
      res.statusCode = fake.status;
      cb(res);
      res.emit('data', fake.body);
      res.emit('end');
    };
    req.destroy = () => {};
    return req;
  },
}));

import {
  parseE164,
  normalizeE164,
  stripWhatsAppPrefix,
  verifyTwilioSignature,
  chunkBody,
  sendWhatsAppMessage,
} from '../../src/modules/whatsapp/twilio';

beforeEach(() => {
  fakeResponses = [];
  capturedRequests = [];
});

// ── Phone-number normalisation ──

describe('parseE164', () => {
  it('accepts a clean E.164 number', () => {
    expect(parseE164('+14155550123')).toBe('+14155550123');
  });

  it('strips spaces, dashes, parentheses and dots', () => {
    expect(parseE164('+1 (415) 555-0123')).toBe('+14155550123');
    expect(parseE164('+44.20.7946.0958')).toBe('+442079460958');
  });

  it('adds a leading + when missing', () => {
    expect(parseE164('14155550123')).toBe('+14155550123');
  });

  it('collapses a 00 international prefix to +', () => {
    expect(parseE164('0014155550123')).toBe('+14155550123');
  });

  it('strips a whatsapp: channel prefix', () => {
    expect(parseE164('whatsapp:+14155550123')).toBe('+14155550123');
  });

  it('rejects junk and empty input', () => {
    expect(() => parseE164('')).toThrow();
    expect(() => parseE164('not-a-number')).toThrow();
    expect(() => parseE164('+123')).toThrow(); // too short
    expect(() => parseE164('+0123456789')).toThrow(); // leading zero in country code
  });
});

describe('normalizeE164', () => {
  it('joins an ISD code and a national number', () => {
    expect(normalizeE164('1', '4155550123')).toBe('+14155550123');
    expect(normalizeE164('+44', '2079460958')).toBe('+442079460958');
  });

  it('keeps the same national number under two ISD codes distinct', () => {
    const us = normalizeE164('1', '5125550000');
    const india = normalizeE164('91', '5125550000');
    expect(us).not.toBe(india);
    expect(us).toBe('+15125550000');
    expect(india).toBe('+915125550000');
  });

  it('rejects an invalid country code or national number', () => {
    expect(() => normalizeE164('', '4155550123')).toThrow();
    expect(() => normalizeE164('12345', '4155550123')).toThrow();
    expect(() => normalizeE164('1', '')).toThrow();
    expect(() => normalizeE164('1', 'abc')).toThrow();
  });
});

describe('stripWhatsAppPrefix', () => {
  it('removes the whatsapp: prefix', () => {
    expect(stripWhatsAppPrefix('whatsapp:+14155550123')).toBe('+14155550123');
  });
  it('leaves a bare number unchanged', () => {
    expect(stripWhatsAppPrefix('+14155550123')).toBe('+14155550123');
  });
});

// ── Request signature verification ──

function signTwilio(authToken: string, url: string, params: Record<string, string>): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

describe('verifyTwilioSignature', () => {
  const token = 'test-auth-token';
  const url = 'https://example.com/webhooks/twilio/whatsapp';
  const params = { From: 'whatsapp:+14155550123', To: 'whatsapp:+14155559999', Body: 'hi' };

  it('accepts a correctly signed request', () => {
    const sig = signTwilio(token, url, params);
    expect(verifyTwilioSignature(token, url, params, sig)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = signTwilio(token, url, params);
    expect(verifyTwilioSignature(token, url, { ...params, Body: 'changed' }, sig)).toBe(false);
  });

  it('rejects a signature made with a different auth token', () => {
    const sig = signTwilio('other-token', url, params);
    expect(verifyTwilioSignature(token, url, params, sig)).toBe(false);
  });

  it('rejects a missing signature header or auth token', () => {
    const sig = signTwilio(token, url, params);
    expect(verifyTwilioSignature(token, url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature('', url, params, sig)).toBe(false);
  });
});

// ── Body chunking ──

describe('chunkBody', () => {
  it('returns a short body as a single chunk', () => {
    expect(chunkBody('hello')).toEqual(['hello']);
  });

  it('splits a long body into multiple WhatsApp-sized chunks', () => {
    const long = 'a'.repeat(4000);
    const chunks = chunkBody(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1600);
    expect(chunks.join('')).toBe(long);
  });

  it('prefers to split on line breaks', () => {
    const body = 'a'.repeat(1500) + '\n' + 'b'.repeat(1500);
    const chunks = chunkBody(body);
    expect(chunks[0]).toBe('a'.repeat(1500));
  });
});

// ── Outbound send ──

describe('sendWhatsAppMessage', () => {
  const creds = { accountSid: 'AC123', authToken: 'tok', whatsappNumber: '+14155559999' };

  it('posts a single message and returns its SID', async () => {
    fakeResponses = [{ status: 201, body: '{"sid":"SM111"}' }];
    const result = await sendWhatsAppMessage(creds, '+14155550123', 'hello there');
    expect(result.sid).toBe('SM111');
    expect(capturedRequests).toHaveLength(1);
    const { payload } = capturedRequests[0];
    expect(payload).toContain('From=whatsapp');
    expect(payload).toContain('To=whatsapp');
    expect(payload).toContain('Body=hello+there');
  });

  it('sends one Twilio request per chunk for a long body and returns the first SID', async () => {
    fakeResponses = [
      { status: 201, body: '{"sid":"SM-first"}' },
      { status: 201, body: '{"sid":"SM-second"}' },
    ];
    const result = await sendWhatsAppMessage(creds, '+14155550123', 'x'.repeat(2500));
    expect(capturedRequests).toHaveLength(2);
    expect(result.sid).toBe('SM-first');
  });

  it('throws when Twilio returns a non-2xx status', async () => {
    fakeResponses = [{ status: 401, body: '{"message":"bad auth"}' }];
    await expect(sendWhatsAppMessage(creds, '+14155550123', 'hi')).rejects.toThrow(/Twilio send failed/);
  });

  it('sends to the visitor number with a whatsapp: prefix and uses Basic auth', async () => {
    fakeResponses = [{ status: 201, body: '{"sid":"SM1"}' }];
    await sendWhatsAppMessage(creds, '+14155550123', 'hi');
    const { options, payload } = capturedRequests[0];
    expect(options.headers.Authorization).toMatch(/^Basic /);
    expect(decodeURIComponent(payload)).toContain('To=whatsapp:+14155550123');
  });
});
