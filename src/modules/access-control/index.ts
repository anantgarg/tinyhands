import { query, queryOne, execute } from '../../db';
import type { AccessRole, Superadmin, AgentAdmin } from '../../types';
import { logger } from '../../utils/logger';

// ── Superadmin Management ──

export async function initSuperadmin(workspaceId: string, userId: string): Promise<boolean> {
  const existing = await queryOne('SELECT user_id FROM superadmins WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
  if (existing) return false; // Already initialized

  await execute('INSERT INTO superadmins (workspace_id, user_id, granted_by) VALUES ($1, $2, $3)', [workspaceId, userId, 'system']);
  logger.info('Superadmin initialized', { workspaceId, userId });
  return true;
}

export async function addSuperadmin(workspaceId: string, userId: string, grantedBy: string): Promise<void> {
  if (!(await isSuperadmin(workspaceId, grantedBy))) {
    throw new Error('Only superadmins can add other superadmins');
  }

  await execute(
    'INSERT INTO superadmins (workspace_id, user_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [workspaceId, userId, grantedBy]
  );

  logger.info('Superadmin added', { workspaceId, userId, grantedBy });
}

export async function removeSuperadmin(workspaceId: string, userId: string, removedBy: string): Promise<void> {
  if (!(await isSuperadmin(workspaceId, removedBy))) {
    throw new Error('Only superadmins can remove other superadmins');
  }

  const countResult = await queryOne<{ count: string }>('SELECT COUNT(*) as count FROM superadmins WHERE workspace_id = $1', [workspaceId]);
  const count = parseInt(countResult?.count || '0', 10);
  if (count <= 1) {
    throw new Error('Cannot remove the last superadmin');
  }

  await execute('DELETE FROM superadmins WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  logger.info('Superadmin removed', { workspaceId, userId, removedBy });
}

export async function isSuperadmin(workspaceId: string, userId: string): Promise<boolean> {
  const row = await queryOne('SELECT user_id FROM superadmins WHERE workspace_id = $1 AND user_id = $2', [workspaceId, userId]);
  return !!row;
}

export async function listSuperadmins(workspaceId: string): Promise<Superadmin[]> {
  return query<Superadmin>('SELECT * FROM superadmins WHERE workspace_id = $1', [workspaceId]);
}

// ── Agent Admin Management ──

export async function addAgentAdmin(
  workspaceId: string,
  agentId: string,
  userId: string,
  role: 'owner' | 'admin',
  grantedBy: string
): Promise<void> {
  if (!(await canModifyAgent(workspaceId, agentId, grantedBy))) {
    throw new Error('Insufficient permissions to add agent admin');
  }

  await execute(`
    INSERT INTO agent_admins (agent_id, user_id, role, granted_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (agent_id, user_id) DO UPDATE SET
      role = EXCLUDED.role,
      granted_by = EXCLUDED.granted_by
  `, [agentId, userId, role, grantedBy]);

  logger.info('Agent admin added', { agentId, userId, role, grantedBy });
}

export async function removeAgentAdmin(workspaceId: string, agentId: string, userId: string, removedBy: string): Promise<void> {
  if (!(await canModifyAgent(workspaceId, agentId, removedBy))) {
    throw new Error('Insufficient permissions to remove agent admin');
  }

  await execute('DELETE FROM agent_admins WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
  logger.info('Agent admin removed', { agentId, userId, removedBy });
}

export async function getAgentAdmins(workspaceId: string, agentId: string): Promise<AgentAdmin[]> {
  return query<AgentAdmin>('SELECT * FROM agent_admins WHERE agent_id = $1', [agentId]);
}

// ── Role Resolution ──

export async function getUserRole(workspaceId: string, agentId: string, userId: string): Promise<AccessRole> {
  if (await isSuperadmin(workspaceId, userId)) return 'superadmin';

  const admin = await queryOne<{ role: string }>(
    'SELECT role FROM agent_admins WHERE agent_id = $1 AND user_id = $2',
    [agentId, userId]
  );

  if (admin?.role === 'owner') return 'owner';
  if (admin?.role === 'admin') return 'admin';

  // Agent creators can always modify their own agents
  const agent = await queryOne<{ created_by: string }>(
    'SELECT created_by FROM agents WHERE workspace_id = $1 AND id = $2',
    [workspaceId, agentId]
  );
  if (agent?.created_by === userId) return 'owner';

  return 'member';
}

export async function canModifyAgent(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const role = await getUserRole(workspaceId, agentId, userId);
  return role === 'superadmin' || role === 'owner' || role === 'admin';
}

export async function canSendTask(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const { canAccessAgent } = await import('../agents');
  return canAccessAgent(workspaceId, agentId, userId);
}

// ── Role Hierarchy Check ──

const ROLE_HIERARCHY: Record<AccessRole, number> = {
  superadmin: 4,
  owner: 3,
  admin: 2,
  member: 1,
};

export function hasMinimumRole(userRole: AccessRole, requiredRole: AccessRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
