import { query, execute } from '../../db';
import { decrypt, encrypt } from './crypto';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import type { Connection } from '../../types';

/**
 * Proactively check all active OAuth connections for token health.
 * - Google: attempt token refresh; if fails, mark expired
 * - Others (Notion, GitHub): check oauth_token_expires_at; if past, mark expired
 * Sends Slack DM to connection owner when a connection expires.
 */
export async function checkConnectionHealth(workspaceId: string): Promise<void> {
  // Get all active connections (both team and personal)
  const connections = await query<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND status = 'active'",
    [workspaceId]
  );

  if (connections.length === 0) return;

  const { isGoogleIntegration, refreshGoogleAccessToken } = await import('./oauth');

  for (const conn of connections) {
    try {
      const credentials = JSON.parse(decrypt(conn.credentials_encrypted, conn.credentials_iv));

      if (isGoogleIntegration(conn.integration_id) && credentials.refresh_token) {
        // Google: attempt token refresh
        try {
          const freshToken = await refreshGoogleAccessToken(conn.workspace_id, credentials.refresh_token);
          credentials.access_token = freshToken;
          const { encrypted, iv } = encrypt(JSON.stringify(credentials));
          await execute(
            'UPDATE connections SET credentials_encrypted = $1, credentials_iv = $2, oauth_token_expires_at = $3, updated_at = NOW() WHERE id = $4',
            [encrypted, iv, new Date(Date.now() + 3600 * 1000).toISOString(), conn.id]
          );
        } catch (refreshErr: any) {
          logger.warn('Google OAuth refresh failed, marking connection expired', {
            connectionId: conn.id,
            integrationId: conn.integration_id,
            error: refreshErr.message,
          });
          await markExpiredAndNotify(conn);
        }
      } else if (conn.oauth_token_expires_at) {
        // Non-Google OAuth: check expiry timestamp
        const expiresAt = new Date(conn.oauth_token_expires_at);
        if (expiresAt <= new Date()) {
          logger.warn('OAuth token expired', {
            connectionId: conn.id,
            integrationId: conn.integration_id,
            expiresAt: conn.oauth_token_expires_at,
          });
          await markExpiredAndNotify(conn);
        }
      }
    } catch (err: any) {
      logger.error('Connection health check failed for connection', {
        connectionId: conn.id,
        error: err.message,
      });
    }
  }
}

async function markExpiredAndNotify(conn: Connection): Promise<void> {
  // Mark as expired
  await execute(
    "UPDATE connections SET status = 'expired', updated_at = NOW() WHERE id = $1",
    [conn.id]
  );

  // Resolve friendly integration label
  let integrationLabel = conn.integration_id;
  try {
    const { getIntegration } = require('../tools/integrations');
    const manifest = getIntegration(conn.integration_id);
    if (manifest) integrationLabel = manifest.label;
  } catch { /* best-effort */ }

  // Send Slack DM to the connection owner
  const notifyUserId = conn.created_by || conn.user_id;
  if (!notifyUserId) return;

  try {
    const { sendDMBlocks } = await import('../../slack');
    const dashboardUrl = config.server.webDashboardUrl;
    const blocks: any[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: Your *${integrationLabel}* connection has expired. Agents using this connection won't be able to access ${integrationLabel} until you reconnect.`,
        },
      },
    ];

    if (dashboardUrl) {
      blocks.push({
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: 'Reconnect in Dashboard' },
          url: `${dashboardUrl}/connections`,
          style: 'primary',
        }],
      });
    }

    await sendDMBlocks(notifyUserId, blocks, `${integrationLabel} connection expired`);
    logger.info('Sent connection expiry notification', { connectionId: conn.id, userId: notifyUserId });
  } catch (err: any) {
    logger.error('Failed to send connection expiry DM', { connectionId: conn.id, error: err.message });
  }
}
