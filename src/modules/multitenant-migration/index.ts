import { queryOne, execute } from '../../db';
import { getSetting } from '../workspace-settings';
import { setAnthropicApiKey } from '../anthropic';
import { upsertUser, setMembership, addPlatformAdmin } from '../users';
import {
  hasOAuthAppConfigured,
  setOAuthAppCredentials,
} from '../workspace-oauth-apps';
import { logger } from '../../utils/logger';

// ── One-shot multi-tenant bootstrap migration ──
// Idempotent. Safe to call on every startup; does the real work only when
// something is still to be done. Three tasks:
//   1. Migrate ANTHROPIC_API_KEY from env into the workspace's encrypted
//      workspace_settings (once). After this, runtime ignores the env var.
//   2. Create users + workspace_memberships + platform_admins rows from any
//      legacy platform_roles entries. Covers existing single-tenant installs.
//   3. Ensure every existing workspace has a workspace_slug (falls through
//      if migration 024 already set it, but we re-assert for safety).

export async function runMultiTenantBootstrap(defaultWorkspaceId: string): Promise<void> {
  await migrateAnthropicKey(defaultWorkspaceId);
  await migrateGoogleOAuthApp(defaultWorkspaceId);
  await backfillMembershipsFromPlatformRoles();
  await ensureWorkspaceSlugs();
}

async function migrateGoogleOAuthApp(workspaceId: string): Promise<void> {
  // Idempotent bootstrap for the single legacy single-tenant install (CometChat).
  // When the legacy env vars are present AND workspace 1 has no google row in
  // workspace_oauth_apps yet, lift those creds into the workspace's encrypted
  // storage exactly once. Every subsequent boot is a no-op.
  const already = await hasOAuthAppConfigured(workspaceId, 'google');
  if (already) return;
  const envClientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const envClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  if (!envClientId || !envClientSecret) return;

  // Same guard as the Anthropic key migration: only lift env creds into a
  // workspace when there's exactly one workspace in the whole deployment.
  // In a multi-tenant deployment the operator's env creds aren't automatically
  // anyone's property.
  const countRow = await queryOne<{ count: number }>('SELECT count(*)::int as count FROM workspaces');
  const wsCount = countRow?.count ?? 0;
  if (wsCount > 1) {
    logger.info('Skipping GOOGLE_OAUTH_CLIENT_ID migration — multi-tenant deployment (each workspace admin must configure their own OAuth app)', { workspaceId, workspaceCount: wsCount });
    return;
  }

  try {
    await setOAuthAppCredentials(workspaceId, 'google', {
      clientId: envClientId,
      clientSecret: envClientSecret,
      publishingStatus: null,
      userId: null,
    });
    logger.info('Migrated GOOGLE_OAUTH_CLIENT_ID/_SECRET from env to workspace_oauth_apps', { workspaceId });
  } catch (err: any) {
    logger.error('Google OAuth app migration failed', { workspaceId, error: err.message });
  }
}

async function migrateAnthropicKey(workspaceId: string): Promise<void> {
  const existing = await getSetting(workspaceId, 'anthropic_api_key');
  if (existing) return; // already migrated
  const envKey = process.env.ANTHROPIC_API_KEY || '';
  if (!envKey) {
    logger.info('No ANTHROPIC_API_KEY in env — workspace admin must set it via dashboard', { workspaceId });
    return;
  }
  // Guard: only copy the env key into a workspace if there's exactly ONE
  // workspace in the whole deployment. That is the legacy single-tenant
  // install case — the env key belongs to the operator and should be lifted
  // into their workspace's encrypted settings exactly once. With multiple
  // workspaces already present, the env key is not automatically anyone's
  // property; each workspace admin must paste their own key via Settings.
  const countRow = await queryOne<{ count: number }>('SELECT count(*)::int as count FROM workspaces');
  const wsCount = countRow?.count ?? 0;
  if (wsCount > 1) {
    logger.info('Skipping ANTHROPIC_API_KEY migration — multi-tenant deployment (workspace admin must set their own key)', { workspaceId, workspaceCount: wsCount });
    return;
  }
  try {
    await setAnthropicApiKey(workspaceId, envKey, 'system-migration');
    logger.info('Migrated ANTHROPIC_API_KEY from env to workspace_settings', { workspaceId });
  } catch (err: any) {
    logger.error('Anthropic key migration failed', { workspaceId, error: err.message });
  }
}

async function backfillMembershipsFromPlatformRoles(): Promise<void> {
  // Skip if platform_roles doesn't exist (fresh install)
  const hasTable = await queryOne<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_roles') AS exists",
  );
  if (!hasTable?.exists) return;

  const roles = await (await import('../../db')).query<{ workspace_id: string; user_id: string; role: string }>(
    'SELECT workspace_id, user_id, role FROM platform_roles',
  );
  for (const r of roles) {
    try {
      const user = await upsertUser({ slackUserId: r.user_id, homeWorkspaceId: r.workspace_id });
      const membershipRole = r.role === 'member' ? 'member' : 'admin';
      await setMembership(r.workspace_id, user.id, membershipRole);
      if (r.role === 'superadmin') {
        await addPlatformAdmin(user.id);
      }
    } catch (err: any) {
      logger.warn('platform_roles backfill row failed', { row: r, error: err.message });
    }
  }
}

async function ensureWorkspaceSlugs(): Promise<void> {
  await execute(
    `UPDATE workspaces
        SET workspace_slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(team_name, id), '[^A-Za-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'))
      WHERE workspace_slug IS NULL OR workspace_slug = ''`,
  );
}
