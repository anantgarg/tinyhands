import { v4 as uuid } from 'uuid';
import https from 'https';
import { queryOne, execute } from '../../db';
import { config } from '../../config';
import { createPersonalConnection } from './index';
import type { OAuthState } from '../../types';
import { logger } from '../../utils/logger';

// ── Supported OAuth Integrations ──

interface OAuthIntegrationConfig {
  id: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: () => string;
  clientSecret: () => string;
}

// Shared Google OAuth config — all Google integrations use the same credentials & scopes
const GOOGLE_OAUTH: Omit<OAuthIntegrationConfig, 'id'> = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
    'https://mail.google.com/',
  ],
  clientId: () => config.oauth.googleClientId,
  clientSecret: () => config.oauth.googleClientSecret,
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
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
    clientId: () => config.oauth.notionClientId,
    clientSecret: () => config.oauth.notionClientSecret,
  },
  github: {
    id: 'github',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org'],
    clientId: () => config.oauth.githubClientId,
    clientSecret: () => config.oauth.githubClientSecret,
  },
};

export function getSupportedOAuthIntegrations(): string[] {
  return Object.keys(OAUTH_INTEGRATIONS).filter(id => {
    const cfg = OAUTH_INTEGRATIONS[id];
    return cfg.clientId() && cfg.clientSecret();
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

  const clientId = integration.clientId();
  if (!clientId) throw new Error(`OAuth not configured for ${integrationId}`);

  const state = uuid();
  const redirectUri = `${config.oauth.redirectBaseUrl}/auth/callback/${integrationId}`;

  // Store state in DB
  await execute(
    `INSERT INTO oauth_states (state, workspace_id, user_id, integration_id, redirect_channel_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [state, wsId, userId, integrationId, channelId || null]
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });

  if (integration.scopes.length > 0) {
    params.set('scope', integration.scopes.join(' '));
  }

  // Google requires access_type=offline + prompt=consent to get a refresh token
  if (integrationId === 'google' || integrationId === 'google_drive') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }

  const url = `${integration.authUrl}?${params.toString()}`;
  return { url, state };
}

export async function handleOAuthCallback(
  integrationId: string,
  code: string,
  state: string,
): Promise<{ wsId: string; userId: string; channelId: string | null }> {
  // Validate state
  const oauthState = await queryOne<OAuthState>(
    'SELECT * FROM oauth_states WHERE state = $1 AND integration_id = $2 AND expires_at > NOW()',
    [state, integrationId]
  );

  if (!oauthState) throw new Error('Invalid or expired OAuth state');

  // Clean up state
  await execute('DELETE FROM oauth_states WHERE state = $1', [state]);

  const integration = OAUTH_INTEGRATIONS[integrationId];
  if (!integration) throw new Error(`Unsupported OAuth integration: ${integrationId}`);

  // Exchange code for tokens
  const redirectUri = `${config.oauth.redirectBaseUrl}/auth/callback/${integrationId}`;
  const tokenData = await exchangeCodeForToken(
    integration.tokenUrl,
    code,
    redirectUri,
    integration.clientId(),
    integration.clientSecret(),
    integrationId,
  );

  // Store as personal connection
  await createPersonalConnection(
    oauthState.workspace_id,
    integrationId,
    oauthState.user_id,
    tokenData,
    `${integrationId} (OAuth)`,
  );

  logger.info('OAuth connection created', { integrationId, userId: oauthState.user_id });

  return {
    wsId: oauthState.workspace_id,
    userId: oauthState.user_id,
    channelId: oauthState.redirect_channel_id,
  };
}

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
