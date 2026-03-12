import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyLinearSignature,
  verifyZendeskSignature,
  verifyIntercomSignature,
  verifyGenericHmac,
} from '../../src/utils/webhooks';

const SECRET = 'test-secret-key';

function hmacHex(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function hmacBase64(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

describe('verifyLinearSignature', () => {
  it('should accept valid signature', () => {
    const payload = '{"action":"create"}';
    const sig = hmacHex(payload, SECRET);
    expect(verifyLinearSignature(payload, sig, SECRET)).toBe(true);
  });

  it('should reject invalid signature', () => {
    // timingSafeEqual requires same-length buffers; provide a valid-length hex string
    const payload = 'payload';
    const realSig = hmacHex(payload, SECRET);
    const fakeSig = realSig.replace(/./g, 'a'); // same length, wrong value
    expect(verifyLinearSignature(payload, fakeSig, SECRET)).toBe(false);
  });

  it('should reject empty secret', () => {
    expect(verifyLinearSignature('payload', 'sig', '')).toBe(false);
  });

  it('should reject empty signature', () => {
    expect(verifyLinearSignature('payload', '', SECRET)).toBe(false);
  });
});

describe('verifyZendeskSignature', () => {
  it('should accept valid base64 signature', () => {
    const payload = '{"ticket_id":123}';
    const sig = hmacBase64(payload, SECRET);
    expect(verifyZendeskSignature(payload, sig, SECRET)).toBe(true);
  });

  it('should reject invalid signature', () => {
    const payload = '{"ticket_id":123}';
    const sig = hmacBase64(payload, SECRET);
    expect(verifyZendeskSignature('tampered', sig, SECRET)).toBe(false);
  });

  it('should reject empty inputs', () => {
    expect(verifyZendeskSignature('payload', '', SECRET)).toBe(false);
    expect(verifyZendeskSignature('payload', 'sig', '')).toBe(false);
  });
});

describe('verifyIntercomSignature', () => {
  it('should accept valid hex signature', () => {
    const payload = '{"event":"conversation.created"}';
    const sig = hmacHex(payload, SECRET);
    expect(verifyIntercomSignature(payload, sig, SECRET)).toBe(true);
  });

  it('should reject tampered payload', () => {
    const sig = hmacHex('original', SECRET);
    expect(verifyIntercomSignature('tampered', sig, SECRET)).toBe(false);
  });
});

describe('verifyGenericHmac', () => {
  it('should accept valid signature', () => {
    const payload = 'generic-payload';
    const sig = hmacHex(payload, SECRET);
    expect(verifyGenericHmac(payload, sig, SECRET)).toBe(true);
  });

  it('should reject mismatched length signatures gracefully', () => {
    expect(verifyGenericHmac('payload', 'short', SECRET)).toBe(false);
  });

  it('should reject empty inputs', () => {
    expect(verifyGenericHmac('payload', '', SECRET)).toBe(false);
    expect(verifyGenericHmac('payload', 'sig', '')).toBe(false);
  });
});
