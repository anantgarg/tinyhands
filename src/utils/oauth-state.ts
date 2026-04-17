import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { config } from '../config';

// ── OAuth `state` parameter ──
// Signed payload so callbacks can prove they came from a flow we started, AND
// carry the workspace + user context through the redirect. Every third-party
// OAuth integration must use these helpers rather than constructing state
// strings by hand — otherwise the callback has no safe way to know which
// workspace to write the credential into.

export interface OAuthStatePayload {
  workspaceId: string;
  userId: string;
  returnTo?: string;
  nonce: string;
  extra?: Record<string, string>;
  expiresAt: number; // unix ms
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  const s = config.server.sessionSecret;
  if (!s) throw new Error('OAuth state signing requires SESSION_SECRET or a derived secret');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

export function encodeOAuthState(input: Omit<OAuthStatePayload, 'nonce' | 'expiresAt'>): string {
  const payload: OAuthStatePayload = {
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function decodeOAuthState(state: string): OAuthStatePayload {
  const [body, sig] = state.split('.');
  if (!body || !sig) throw new Error('Invalid state format');

  const expected = sign(body);
  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Invalid state signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (!payload.workspaceId || !payload.userId || !payload.nonce) {
    throw new Error('Invalid state payload');
  }
  if (typeof payload.expiresAt === 'number' && payload.expiresAt < Date.now()) {
    throw new Error('State expired');
  }
  return payload;
}
