import { query, queryOne, execute, withTransaction } from '../../db';
import type { User, WorkspaceMembership, WorkspaceRole, PlatformAdmin } from '../../types';
import { logger } from '../../utils/logger';

// ── User CRUD ──

/**
 * Deterministic user id derived from Slack identity. Users who sign in from two
 * separate Slack workspaces become two distinct user rows (that's intentional —
 * Slack user_ids are per-team, not global). Both rows can share memberships in
 * any number of workspaces via workspace_memberships.
 */
function userIdFor(slackUserId: string, homeWorkspaceId: string): string {
  return `${homeWorkspaceId}:${slackUserId}`;
}

export async function upsertUser(data: {
  slackUserId: string;
  homeWorkspaceId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}): Promise<User> {
  const id = userIdFor(data.slackUserId, data.homeWorkspaceId);
  const row = await queryOne<User>(
    `INSERT INTO users (id, slack_user_id, home_workspace_id, display_name, email, avatar_url, active_workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $3)
     ON CONFLICT (slack_user_id, home_workspace_id) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       email = COALESCE(EXCLUDED.email, users.email),
       avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
       updated_at = NOW()
     RETURNING *`,
    [id, data.slackUserId, data.homeWorkspaceId, data.displayName || null, data.email || null, data.avatarUrl || null],
  );
  return row!;
}

export async function getUser(userId: string): Promise<User | null> {
  const row = await queryOne<User>('SELECT * FROM users WHERE id = $1', [userId]);
  return row || null;
}

export async function getUserBySlackId(slackUserId: string, workspaceId: string): Promise<User | null> {
  const row = await queryOne<User>(
    'SELECT * FROM users WHERE slack_user_id = $1 AND home_workspace_id = $2',
    [slackUserId, workspaceId],
  );
  return row || null;
}

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
  // Must be a member of the workspace
  const membership = await getMembership(workspaceId, userId);
  if (!membership) {
    throw new Error('User is not a member of that workspace');
  }
  await execute('UPDATE users SET active_workspace_id = $1, updated_at = NOW() WHERE id = $2', [workspaceId, userId]);
  logger.info('Active workspace switched', { userId, workspaceId });
}

// ── Membership CRUD ──

export async function getMembership(workspaceId: string, userId: string): Promise<WorkspaceMembership | null> {
  const row = await queryOne<WorkspaceMembership>(
    'SELECT * FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId],
  );
  return row || null;
}

export async function listUserWorkspaces(userId: string): Promise<Array<{ workspace_id: string; role: WorkspaceRole; team_name: string; workspace_slug: string }>> {
  return query(
    `SELECT wm.workspace_id, wm.role, w.team_name, w.workspace_slug
     FROM workspace_memberships wm
     JOIN workspaces w ON w.id = wm.workspace_id
     WHERE wm.user_id = $1 AND w.status = 'active'
     ORDER BY w.team_name`,
    [userId],
  );
}

export async function listWorkspaceMembers(workspaceId: string): Promise<Array<WorkspaceMembership & Pick<User, 'slack_user_id' | 'display_name' | 'email'>>> {
  return query(
    `SELECT wm.*, u.slack_user_id, u.display_name, u.email
     FROM workspace_memberships wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.role, u.display_name`,
    [workspaceId],
  );
}

export async function setMembership(workspaceId: string, userId: string, role: WorkspaceRole): Promise<void> {
  await execute(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()`,
    [workspaceId, userId, role],
  );
  logger.info('Workspace membership set', { workspaceId, userId, role });
}

export async function removeMembership(workspaceId: string, userId: string): Promise<void> {
  await withTransaction(async (client) => {
    const existing = await client.query<WorkspaceMembership>(
      'SELECT * FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
    if (existing.rowCount === 0) return;

    // Guard: never remove the last admin of an active workspace
    if (existing.rows[0].role === 'admin') {
      const adminCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM workspace_memberships WHERE workspace_id = $1 AND role = 'admin'",
        [workspaceId],
      );
      if (parseInt(adminCount.rows[0].count, 10) <= 1) {
        throw new Error('Cannot remove the last admin of a workspace');
      }
    }

    await client.query(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId],
    );
  });
  logger.info('Workspace membership removed', { workspaceId, userId });
}

export async function isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const m = await getMembership(workspaceId, userId);
  return m?.role === 'admin';
}

export async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  return (await getMembership(workspaceId, userId)) !== null;
}

// ── Platform Admins ──

export async function addPlatformAdmin(userId: string, email?: string): Promise<void> {
  await execute(
    'INSERT INTO platform_admins (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [userId, email || null],
  );
  logger.info('Platform admin added', { userId });
}

export async function removePlatformAdmin(userId: string): Promise<void> {
  const count = await queryOne<{ count: string }>('SELECT COUNT(*)::text AS count FROM platform_admins');
  if (parseInt(count?.count || '0', 10) <= 1) {
    throw new Error('Cannot remove the last platform admin');
  }
  await execute('DELETE FROM platform_admins WHERE user_id = $1', [userId]);
  logger.info('Platform admin removed', { userId });
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const row = await queryOne<PlatformAdmin>('SELECT * FROM platform_admins WHERE user_id = $1', [userId]);
  return !!row;
}

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  return query<PlatformAdmin>('SELECT * FROM platform_admins ORDER BY created_at');
}
