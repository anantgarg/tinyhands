import { query } from '../../db';
import type { AccessRole, Superadmin, AgentAdmin } from '../../types';
import { logger } from '../../utils/logger';

// ── Superadmin Management ──

export async function initSuperadmin(userId: string): Promise<boolean> {
  const { rows: existing } = await query('SELECT user_id FROM superadmins LIMIT 1');
  if (existing.length > 0) return false; // Already initialized

  await query('INSERT INTO superadmins (user_id, granted_by) VALUES ($1, $2)', [userId, 'system']);
  logger.info('Superadmin initialized', { userId });
  return true;
}

export async function addSuperadmin(userId: string, grantedBy: string): Promise<void> {
  if (!(await isSuperadmin(grantedBy))) {
    throw new Error('Only superadmins can add other superadmins');
  }

  await query(
    'INSERT INTO superadmins (user_id, granted_by) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
    [userId, grantedBy]
  );

  logger.info('Superadmin added', { userId, grantedBy });
}

export async function removeSuperadmin(userId: string, removedBy: string): Promise<void> {
  if (!(await isSuperadmin(removedBy))) {
    throw new Error('Only superadmins can remove other superadmins');
  }

  const { rows: countRows } = await query('SELECT COUNT(*) as count FROM superadmins');
  if (parseInt(countRows[0].count) <= 1) {
    throw new Error('Cannot remove the last superadmin');
  }

  await query('DELETE FROM superadmins WHERE user_id = $1', [userId]);
  logger.info('Superadmin removed', { userId, removedBy });
}

export async function isSuperadmin(userId: string): Promise<boolean> {
  const { rows } = await query('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  return rows.length > 0;
}

export async function listSuperadmins(): Promise<Superadmin[]> {
  const { rows } = await query('SELECT * FROM superadmins');
  return rows as Superadmin[];
}

// ── Agent Admin Management ──

export async function addAgentAdmin(
  agentId: string,
  userId: string,
  role: 'owner' | 'admin',
  grantedBy: string
): Promise<void> {
  if (!(await canModifyAgent(agentId, grantedBy))) {
    throw new Error('Insufficient permissions to add agent admin');
  }

  await query(`
    INSERT INTO agent_admins (agent_id, user_id, role, granted_by)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (agent_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by
  `, [agentId, userId, role, grantedBy]);

  logger.info('Agent admin added', { agentId, userId, role, grantedBy });
}

export async function removeAgentAdmin(agentId: string, userId: string, removedBy: string): Promise<void> {
  if (!(await canModifyAgent(agentId, removedBy))) {
    throw new Error('Insufficient permissions to remove agent admin');
  }

  await query('DELETE FROM agent_admins WHERE agent_id = $1 AND user_id = $2', [agentId, userId]);
  logger.info('Agent admin removed', { agentId, userId, removedBy });
}

export async function getAgentAdmins(agentId: string): Promise<AgentAdmin[]> {
  const { rows } = await query('SELECT * FROM agent_admins WHERE agent_id = $1', [agentId]);
  return rows as AgentAdmin[];
}

// ── Role Resolution ──

export async function getUserRole(agentId: string, userId: string): Promise<AccessRole> {
  if (await isSuperadmin(userId)) return 'superadmin';

  const { rows } = await query(
    'SELECT role FROM agent_admins WHERE agent_id = $1 AND user_id = $2',
    [agentId, userId]
  );

  if (rows[0]?.role === 'owner') return 'owner';
  if (rows[0]?.role === 'admin') return 'admin';
  return 'member';
}

export async function canModifyAgent(agentId: string, userId: string): Promise<boolean> {
  const role = await getUserRole(agentId, userId);
  return role === 'superadmin' || role === 'owner' || role === 'admin';
}

export async function canSendTask(agentId: string, userId: string): Promise<boolean> {
  // All workspace members can send tasks
  return true;
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
