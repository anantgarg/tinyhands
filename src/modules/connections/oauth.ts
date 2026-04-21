import { v4 as uuid } from 'uuid';
import https from 'https';
import { queryOne, execute } from '../../db';
import { config } from '../../config';
import { createPersonalConnection } from './index';
import type { OAuthState, OAuthAppProvider } from '../../types';
import { logger } from '../../utils/logger';
import {
  getOAuthAppCredentials,
  listConfiguredProviders,
  OAuthAppNotConfiguredError,
} from '../workspace-oauth-apps';

// ── Re-export the typed error so callers don't need a second import path ──
export { OAuthAppNotConfiguredError };

// ── Supported OAuth Integrations ──
//
// Per-integration metadata (URLs, scopes, which provider bucket the integration
// maps to). Client credentials are no longer stored here — they are resolved
// from `workspace_oauth_apps` at the time of `getOAuthUrl` / `handleOAuthCallback`
// via `getOAuthAppCredentials(workspaceId, provider)`.

interface OAuthIntegrationConfig {
  id: string;
  provider: OAuthAppProvider;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
}

// Shared Google OAuth config — all Google integrations use the same credentials & scopes
const GOOGLE_OAUTH: Omit<OAuthIntegrationConfig, 'id'> = {
  provider: 'google',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
    'https://mail.google.com/',
  ],
};

const OAUTH_INTEGRATIONS: Record<string, OAuthIntegrationConfig> = {
  google:          { id: 'google', ...GOOGLE_OAUTH },
  google_drive:    { id: 'google_drive', ...GOOGLE_OAUTH },
  'google-drive':  { id: 'google-drive', ...GOOGLE_OAUTH },
  'google-sheets': { id: 'google-sheets', ...GOOGLE_OAUTH },
  'google-docs':   { id: 'google-docs', ...GOOGLE_OAUTH },
  gmail:           { id: 'gmail', ...GOOGLE_OAUTH },
  notion: {
    id: 'notion',
    provider: 'notion',
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
  },
  github: {
    id: 'github',
    provider: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
  },
};

const GOOGLE_INTEGRATION_IDS = new Set(['google', 'google_drive', 'google-drive', 'google-sheets', 'google-docs', 'gmail']);

export function isGoogleIntegration(integrationId: string): boolean {
  return GOOGLE_INTEGRATION_IDS.has(integrationId);
}

/**
 * Resolve an integration id (e.g. 'google-drive', 'gmail') to its provider
 * bucket in `workspace_oauth_apps` (e.g. 'google'). Null for unknown ids.
 */
export function getProviderForIntegration(integrationId: string): OAuthAppProvider | null {
  const cfg = OAUTH_INTEGRATIONS[integrationId];
  return cfg ? cfg.provider : null;
}

/**
 * List OAuth-capable integrations the given workspace can currently initiate.
 * Filters by which providers the workspace has configured in `workspace_oauth_apps`.
 */
export async function getSupportedOAuthIntegrations(workspaceId: string): Promise<string[]> {
  const configured = new Set(await listConfiguredProviders(workspaceId));
  return Object.keys(OAUTH_INTEGRATIONS).filter((id) => {
    const cfg = OAUTH_INTEGRATIONS[id];
    return configured.has(cfg.provider);
  });
}

export async function getOAuthUrl(
  integrationId: string,
  wsId: string,
  userId: string,
  channelId?: string,
): Promise<{ url: string; state: string }> {
  const integration = OAUTH_INTEGRATIONS[integrationId];
  if (!integration) throw new Error(`Unsupported OAuth integration: ${integrationId}`);

  const creds = await getOAuthAppCredentials(wsId, integration.provider);
  if (!creds) throw new OAuthAppNotConfiguredError(wsId, integration.provider);

  const state = uuid();
  // All Google integrations share one registered redirect URI
  const callbackId = GOOGLE_INTEGRATION_IDS.has(integrationId) ? 'google' : integrationId;
  const redirectUri = `${config.oauth.redirectBaseUrl}/auth/callback/${callbackId}`;

  // Store state in DB
  await execute(
    `INSERT INTO oauth_states (state, workspace_id, user_id, integration_id, redirect_channel_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, wsId, userId, integrationId, channelId || null]
  );

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });

  if (integration.scopes.length > 0) {
    params.set('scope', integration.scopes.join(' '));
  }

  // Google requires access_type=offline + prompt=consent to get a refresh token
  if (GOOGLE_INTEGRATION_IDS.has(integrationId)) {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  const url = `${integration.authUrl}?${params.toString()}`;
  return { url, state };
}

export async function handleOAuthCallback(
  callbackIntegrationId: string,
  code: string,
  state: string,
): Promise<{ wsId: string; userId: string; channelId: string | null }> {
  // Validate state — look up by state token only (integration_id in state may differ from callback path)
  const oauthState = await queryOne<OAuthState>(
    'SELECT * FROM oauth_states WHERE state = $1 AND expires_at > NOW()',
    [state]
  );

  if (!oauthState) throw new Error('Invalid or expired OAuth state');

  // Use the original integration ID from the stored state (e.g. google-drive, gmail)
  const actualIntegrationId = oauthState.integration_id;

  // Clean up state
  await execute('DELETE FROM oauth_states WHERE state = $1', [state]);

  const integration = OAUTH_INTEGRATIONS[actualIntegrationId] || OAUTH_INTEGRATIONS[callbackIntegrationId];
  if (!integration) throw new Error(`Unsupported OAuth integration: ${actualIntegrationId}`);

  const creds = await getOAuthAppCredentials(oauthState.workspace_id, integration.provider);
  if (!creds) throw new OAuthAppNotConfiguredError(oauthState.workspace_id, integration.provider);

  // Exchange code for tokens — use the callback path that Google expects
  const redirectUri = `${config.oauth.redirectBaseUrl}/auth/callback/${callbackIntegrationId}`;
  const tokenData = await exchangeCodeForToken(
    integration.tokenUrl,
    code,
    redirectUri,
    creds.clientId,
    creds.clientSecret,
    actualIntegrationId,
  );

  // For Google, a single consent grants all four scopes (Drive, Sheets, Docs,
  // Gmail). Fan out into one connection row per sub-service so agent-level
  // credential resolution (which looks up by specific integration_id like
  // 'gmail' or 'google-drive') keeps working unchanged.
  const targetIntegrationIds = GOOGLE_INTEGRATION_IDS.has(actualIntegrationId)
    ? ['gmail', 'google-drive', 'google-sheets', 'google-docs']
    : [actualIntegrationId];

  for (const id of targetIntegrationIds) {
    await createPersonalConnection(
      oauthState.workspace_id,
      id,
      oauthState.user_id,
      tokenData,
      `${id} (OAuth)`,
    );
  }

  // Store token expiry if available
  if (tokenData.expires_in) {
    const expiresAt = new Date(Date.now() + parseInt(tokenData.expires_in) * 1000);
    for (const id of targetIntegrationIds) {
      await execute(
        `UPDATE connections SET oauth_token_expires_at = $1
         WHERE workspace_id = $2 AND integration_id = $3 AND user_id = $4 AND connection_type = 'personal' AND status = 'active'`,
        [expiresAt.toISOString(), oauthState.workspace_id, id, oauthState.user_id]
      );
    }
  }

  logger.info('OAuth connection created', {
    integrationId: actualIntegrationId,
    expandedIds: targetIntegrationIds,
    userId: oauthState.user_id,
  });

  return {
    wsId: oauthState.workspace_id,
    userId: oauthState.user_id,
    channelId: oauthState.redirect_channel_id,
  };
}

// ── Google OAuth Token Refresh ──

/**
 * Refresh a Google OAuth access token using the stored refresh_token.
 * Uses the workspace's own OAuth client credentials — the platform no longer
 * holds a Google OAuth identity.
 */
export async function refreshGoogleAccessToken(
  workspaceId: string,
  refreshToken: string,
): Promise<string> {
  const creds = await getOAuthAppCredentials(workspaceId, 'google');
  if (!creds) {
    throw new OAuthAppNotConfiguredError(workspaceId, 'google');
  }

  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error || !parsed.access_token) {
            reject(new Error(`Google token refresh failed: ${parsed.error_description || parsed.error || 'no access_token'}`));
            return;
          }
          resolve(parsed.access_token);
        } catch {
          reject(new Error('Failed to parse Google token refresh response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Token Exchange ──

async function exchangeCodeForToken(
  tokenUrl: string,
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  integrationId: string,
): Promise<Record<string, string>> {
  // Google and GitHub require form-encoded body; Notion uses JSON with Basic auth
  const isFormEncoded = integrationId !== 'notion';
  const bodyParams: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  };

  const body = isFormEncoded
    ? new URLSearchParams(bodyParams).toString()
    : JSON.stringify(bodyParams);

  return new Promise((resolve, reject) => {
    const url = new URL(tokenUrl);
    const headers: Record<string, string> = {
      'Content-Type': isFormEncoded ? 'application/x-www-form-urlencoded' : 'application/json',
      'Accept': 'application/json',
    };

    // Notion uses Basic auth
    if (integrationId === 'notion') {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`OAuth token error: ${parsed.error_description || parsed.error}`));
            return;
          }
          const result: Record<string, string> = {};
          if (parsed.access_token) result.access_token = parsed.access_token;
          if (parsed.refresh_token) result.refresh_token = parsed.refresh_token;
          if (parsed.token_type) result.token_type = parsed.token_type;
          if (parsed.expires_in) result.expires_in = String(parsed.expires_in);
          resolve(result);
        } catch {
          reject(new Error('Failed to parse OAuth token response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
