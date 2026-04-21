import https from 'https';
import { queryOne, execute } from '../../db';
import { encrypt, decrypt } from '../connections/crypto';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import type {
  OAuthAppProvider,
  OAuthAppPublishingStatus,
  WorkspaceOAuthApp,
} from '../../types';

// ── Per-workspace OAuth app credentials ──
// Each workspace brings its own OAuth client. The platform never owns a
// Google / Notion / GitHub OAuth identity of its own at runtime. Credentials
// here are resolved by src/modules/connections/oauth.ts before every auth-URL
// build and token exchange.

export const SUPPORTED_PROVIDERS: readonly OAuthAppProvider[] = [
  'google',
  'notion',
  'github',
] as const;

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export class OAuthAppNotConfiguredError extends Error {
  constructor(public workspaceId: string, public provider: OAuthAppProvider) {
    super(
      `Workspace ${workspaceId} has not configured a ${provider} OAuth app. ` +
      `An admin must set one up in Settings → Integrations.`,
    );
    this.name = 'OAuthAppNotConfiguredError';
  }
}

export interface OAuthAppSummary {
  workspaceId: string;
  provider: OAuthAppProvider;
  clientId: string;
  clientIdMasked: string;
  publishingStatus: OAuthAppPublishingStatus | null;
  configuredByUserId: string | null;
  configuredAt: string;
  updatedAt: string;
}

export interface OAuthAppCredentials {
  clientId: string;
  clientSecret: string;
}

export interface SetOAuthAppInput {
  clientId: string;
  clientSecret: string;
  publishingStatus?: OAuthAppPublishingStatus | null;
  userId: string | null;
}

// ── Helpers ──

function maskClientId(clientId: string): string {
  if (!clientId) return '';
  if (clientId.length <= 10) return clientId.replace(/.(?=.{4})/g, '•');
  const head = clientId.slice(0, 6);
  const tail = clientId.slice(-8);
  return `${head}••••${tail}`;
}

function toSummary(row: WorkspaceOAuthApp): OAuthAppSummary {
  return {
    workspaceId: row.workspace_id,
    provider: row.provider,
    clientId: row.client_id,
    clientIdMasked: maskClientId(row.client_id),
    publishingStatus: row.publishing_status,
    configuredByUserId: row.configured_by_user_id,
    configuredAt: row.configured_at,
    updatedAt: row.updated_at,
  };
}

function assertSupportedProvider(provider: string): asserts provider is OAuthAppProvider {
  if (!SUPPORTED_PROVIDERS.includes(provider as OAuthAppProvider)) {
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}

export function isValidGoogleClientId(clientId: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId);
}

export function isValidGoogleClientSecret(clientSecret: string): boolean {
  return /^GOCSPX-[A-Za-z0-9_-]{20,}$/.test(clientSecret);
}

// ── CRUD ──

export async function getOAuthAppCredentials(
  workspaceId: string,
  provider: OAuthAppProvider,
): Promise<OAuthAppCredentials | null> {
  assertSupportedProvider(provider);
  const row = await queryOne<WorkspaceOAuthApp>(
    `SELECT * FROM workspace_oauth_apps WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  if (!row) return null;
  try {
    const clientSecret = decrypt(row.client_secret_encrypted, row.client_secret_iv);
    return { clientId: row.client_id, clientSecret };
  } catch (err: any) {
    logger.error('Failed to decrypt workspace OAuth app secret', {
      workspaceId, provider, error: err.message,
    });
    return null;
  }
}

export async function getOAuthAppSummary(
  workspaceId: string,
  provider: OAuthAppProvider,
): Promise<OAuthAppSummary | null> {
  assertSupportedProvider(provider);
  const row = await queryOne<WorkspaceOAuthApp>(
    `SELECT * FROM workspace_oauth_apps WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  return row ? toSummary(row) : null;
}

export async function hasOAuthAppConfigured(
  workspaceId: string,
  provider: OAuthAppProvider,
): Promise<boolean> {
  assertSupportedProvider(provider);
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM workspace_oauth_apps WHERE workspace_id = $1 AND provider = $2
     ) AS exists`,
    [workspaceId, provider],
  );
  return !!row?.exists;
}

export async function setOAuthAppCredentials(
  workspaceId: string,
  provider: OAuthAppProvider,
  input: SetOAuthAppInput,
): Promise<OAuthAppSummary> {
  assertSupportedProvider(provider);
  const clientId = (input.clientId || '').trim();
  const clientSecret = (input.clientSecret || '').trim();
  if (!clientId) throw new Error('clientId is required');
  if (!clientSecret) throw new Error('clientSecret is required');

  if (provider === 'google') {
    if (!isValidGoogleClientId(clientId)) {
      throw new Error('clientId does not look like a Google OAuth client id (expected NNN-xxx.apps.googleusercontent.com)');
    }
    if (!isValidGoogleClientSecret(clientSecret)) {
      throw new Error('clientSecret does not look like a Google OAuth client secret (expected GOCSPX-…)');
    }
  }

  const { encrypted, iv } = encrypt(clientSecret);
  const publishingStatus = input.publishingStatus ?? null;

  await execute(
    `INSERT INTO workspace_oauth_apps
       (workspace_id, provider, client_id, client_secret_encrypted, client_secret_iv,
        publishing_status, configured_by_user_id, configured_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       client_id = EXCLUDED.client_id,
       client_secret_encrypted = EXCLUDED.client_secret_encrypted,
       client_secret_iv = EXCLUDED.client_secret_iv,
       publishing_status = EXCLUDED.publishing_status,
       configured_by_user_id = EXCLUDED.configured_by_user_id,
       updated_at = NOW()`,
    [workspaceId, provider, clientId, encrypted, iv, publishingStatus, input.userId],
  );

  logger.info('Workspace OAuth app credentials set', {
    workspaceId, provider, userId: input.userId, publishingStatus,
  });

  const summary = await getOAuthAppSummary(workspaceId, provider);
  if (!summary) throw new Error('Failed to read back OAuth app credentials after save');
  return summary;
}

export async function clearOAuthAppCredentials(
  workspaceId: string,
  provider: OAuthAppProvider,
): Promise<void> {
  assertSupportedProvider(provider);
  await execute(
    `DELETE FROM workspace_oauth_apps WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  logger.info('Workspace OAuth app credentials cleared', { workspaceId, provider });
}

// ── Test (preflight) ──
// We can't fully verify an OAuth client without a consent round-trip; a HEAD
// request against the auth endpoint surfaces the obvious misconfigurations
// (missing/invalid client id, unregistered redirect URI) without any user
// interaction.

export async function testOAuthAppCredentials(
  workspaceId: string,
  provider: OAuthAppProvider,
): Promise<{ ok: boolean; errorCode?: string; reason?: string }> {
  assertSupportedProvider(provider);
  if (provider !== 'google') {
    return { ok: false, errorCode: 'unsupported_provider', reason: `Test is only implemented for Google today.` };
  }
  const creds = await getOAuthAppCredentials(workspaceId, provider);
  if (!creds) return { ok: false, errorCode: 'not_configured', reason: 'No credentials saved.' };

  const redirectUri = `${config.oauth.redirectBaseUrl}/auth/callback/google`;
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline',
    prompt: 'consent',
  });
  const url = `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;

  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'HEAD',
      timeout: 10000,
    }, (res) => {
      const status = res.statusCode || 0;
      // Google responds with 302 (redirect to consent) on a valid client id +
      // registered redirect URI. 400 means the client id / redirect URI pair
      // is broken; any other 4xx/5xx we surface as an error.
      if (status === 302 || status === 303) {
        resolve({ ok: true });
      } else if (status === 400) {
        resolve({
          ok: false,
          errorCode: 'invalid_client_or_redirect',
          reason: 'Google rejected the request — the client id is wrong or the redirect URI is not registered in your OAuth client.',
        });
      } else {
        resolve({
          ok: false,
          errorCode: 'unexpected_status',
          reason: `Google returned HTTP ${status}. Check your credentials and redirect URI.`,
        });
      }
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, errorCode: 'timeout', reason: 'Timed out reaching accounts.google.com.' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, errorCode: 'network', reason: `Network error reaching Google: ${err.message}` });
    });
    req.end();
  });
}

// ── Supported-provider filtering ──

export async function listConfiguredProviders(workspaceId: string): Promise<OAuthAppProvider[]> {
  const rows = await (await import('../../db')).query<{ provider: OAuthAppProvider }>(
    `SELECT provider FROM workspace_oauth_apps WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows.map((r) => r.provider);
}
