import { getDb } from '../../db';
import type { AccessRole, Superadmin, AgentAdmin } from '../../types';
import { logger } from '../../utils/logger';

// ── Superadmin Management ──

export function initSuperadmin(userId: string): boolean {
  const db = getDb();
  const existing = db.prepare('SELECT user_id FROM superadmins LIMIT 1').get();
  if (existing) return false; // Already initialized

  db.prepare('INSERT INTO superadmins (user_id, granted_by) VALUES (?, ?)').run(userId, 'system');
  logger.info('Superadmin initialized', { userId });
  return true;
}

export function addSuperadmin(userId: string, grantedBy: string): void {
  if (!isSuperadmin(grantedBy)) {
    throw new Error('Only superadmins can add other superadmins');
  }

  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO superadmins (user_id, granted_by) VALUES (?, ?)'
  ).run(userId, grantedBy);

  logger.info('Superadmin added', { userId, grantedBy });
}

export function removeSuperadmin(userId: string, removedBy: string): void {
  if (!isSuperadmin(removedBy)) {
    throw new Error('Only superadmins can remove other superadmins');
  }

  const db = getDb();
  const count = (db.prepare('SELECT COUNT(*) as count FROM superadmins').get() as any).count;
  if (count <= 1) {
    throw new Error('Cannot remove the last superadmin');
  }

  db.prepare('DELETE FROM superadmins WHERE user_id = ?').run(userId);
  logger.info('Superadmin removed', { userId, removedBy });
}

export function isSuperadmin(userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT user_id FROM superadmins WHERE user_id = ?').get(userId);
  return !!row;
}

export function listSuperadmins(): Superadmin[] {
  const db = getDb();
  return db.prepare('SELECT * FROM superadmins').all() as Superadmin[];
}

// ── Agent Admin Management ──

export function addAgentAdmin(
  agentId: string,
  userId: string,
  role: 'owner' | 'admin',
  grantedBy: string
): void {
  if (!canModifyAgent(agentId, grantedBy)) {
    throw new Error('Insufficient permissions to add agent admin');
  }

  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO agent_admins (agent_id, user_id, role, granted_by)
    VALUES (?, ?, ?, ?)
  `).run(agentId, userId, role, grantedBy);

  logger.info('Agent admin added', { agentId, userId, role, grantedBy });
}

export function removeAgentAdmin(agentId: string, userId: string, removedBy: string): void {
  if (!canModifyAgent(agentId, removedBy)) {
    throw new Error('Insufficient permissions to remove agent admin');
  }

  const db = getDb();
  db.prepare('DELETE FROM agent_admins WHERE agent_id = ? AND user_id = ?').run(agentId, userId);
  logger.info('Agent admin removed', { agentId, userId, removedBy });
}

export function getAgentAdmins(agentId: string): AgentAdmin[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agent_admins WHERE agent_id = ?').all(agentId) as AgentAdmin[];
}

// ── Role Resolution ──

export function getUserRole(agentId: string, userId: string): AccessRole {
  if (isSuperadmin(userId)) return 'superadmin';

  const db = getDb();
  const admin = db.prepare(
    'SELECT role FROM agent_admins WHERE agent_id = ? AND user_id = ?'
  ).get(agentId, userId) as { role: string } | undefined;

  if (admin?.role === 'owner') return 'owner';
  if (admin?.role === 'admin') return 'admin';
  return 'member';
}

export function canModifyAgent(agentId: string, userId: string): boolean {
  const role = getUserRole(agentId, userId);
  return role === 'superadmin' || role === 'owner' || role === 'admin';
}

export function canSendTask(agentId: string, userId: string): boolean {
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
