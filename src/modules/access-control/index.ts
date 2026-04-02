import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import type { AccessRole, Superadmin, AgentAdmin, PlatformRole, AgentAccessLevel, PlatformRoleRecord, AgentRoleRecord, UpgradeRequest } from '../../types';
import { logger } from '../../utils/logger';

// ── Role Hierarchies ──

const _PLATFORM_ROLE_HIERARCHY: Record<PlatformRole, number> = {
  superadmin: 3,
  admin: 2,
  member: 1,
};

const AGENT_ROLE_HIERARCHY: Record<AgentAccessLevel, number> = {
  owner: 3,
  member: 2,
  viewer: 1,
  none: 0,
};

// Backward compat hierarchy
const ROLE_HIERARCHY: Record<AccessRole, number> = {
  superadmin: 4,
  owner: 3,
  admin: 2,
  member: 1,
};

// ── Platform Role Management ──

export async function getPlatformRole(workspaceId: string, userId: string): Promise<PlatformRole> {
  const row = await queryOne<PlatformRoleRecord>(
    'SELECT * FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );
  return (row?.role as PlatformRole) || 'member';
}

export async function setPlatformRole(workspaceId: string, userId: string, role: PlatformRole, grantedBy: string): Promise<void> {
  await execute(
    `INSERT INTO platform_roles (workspace_id, user_id, role, granted_by, granted_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`,
    [workspaceId, userId, role, grantedBy]
  );
  logger.info('Platform role set', { workspaceId, userId, role, grantedBy });
}

export async function removePlatformRole(workspaceId: string, userId: string, removedBy: string): Promise<void> {
  // Prevent removing last superadmin
  const countResult = await queryOne<{ count: string }>(
    "SELECT COUNT(*) as count FROM platform_roles WHERE workspace_id = $1 AND role = 'superadmin'",
    [workspaceId]
  );
  const currentRole = await getPlatformRole(workspaceId, userId);
  if (currentRole === 'superadmin') {
    const count = parseInt(countResult?.count || '0', 10);
    if (count <= 1) {
      throw new Error('Cannot remove the last superadmin');
    }
  }
  await execute(
    'DELETE FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );
  logger.info('Platform role removed', { workspaceId, userId, removedBy });
}

export async function listPlatformAdmins(workspaceId: string): Promise<PlatformRoleRecord[]> {
  return query<PlatformRoleRecord>(
    "SELECT * FROM platform_roles WHERE workspace_id = $1 AND role IN ('superadmin', 'admin')",
    [workspaceId]
  );
}

export async function isPlatformAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const role = await getPlatformRole(workspaceId, userId);
  return role === 'superadmin' || role === 'admin';
}

// ── Agent Role Management ──

export async function getAgentRole(workspaceId: string, agentId: string, userId: string): Promise<AgentAccessLevel> {
  // Platform admins get owner-level access
  const platformRole = await getPlatformRole(workspaceId, userId);
  if (platformRole === 'superadmin' || platformRole === 'admin') {
    return 'owner';
  }

  // Check explicit agent role
  const agentRole = await queryOne<AgentRoleRecord>(
    'SELECT * FROM agent_roles WHERE agent_id = $1 AND user_id = $2',
    [agentId, userId]
  );
  if (agentRole) {
    return agentRole.role as AgentAccessLevel;
  }

  // Fall back to agent's default_access
  const agent = await queryOne<{ default_access: string }>(
    'SELECT default_access FROM agents WHERE workspace_id = $1 AND id = $2',
    [workspaceId, agentId]
  );
  return (agent?.default_access as AgentAccessLevel) || 'viewer';
}

export async function setAgentRole(workspaceId: string, agentId: string, userId: string, role: AgentAccessLevel, grantedBy: string): Promise<void> {
  await execute(
    `INSERT INTO agent_roles (agent_id, user_id, role, granted_by, granted_at, workspace_id)
     VALUES ($1, $2, $3, $4, NOW(), $5)
     ON CONFLICT (agent_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`,
    [agentId, userId, role, grantedBy, workspaceId]
  );
  logger.info('Agent role set', { agentId, userId, role, grantedBy });
}

export async function removeAgentRole(workspaceId: string, agentId: string, userId: string): Promise<void> {
  await execute(
    'DELETE FROM agent_roles WHERE agent_id = $1 AND user_id = $2',
    [agentId, userId]
  );
  logger.info('Agent role removed', { agentId, userId });
}

export async function getAgentRoles(workspaceId: string, agentId: string): Promise<AgentRoleRecord[]> {
  return query<AgentRoleRecord>(
    'SELECT * FROM agent_roles WHERE workspace_id = $1 AND agent_id = $2',
    [workspaceId, agentId]
  );
}

export async function getAgentOwners(workspaceId: string, agentId: string): Promise<AgentRoleRecord[]> {
  return query<AgentRoleRecord>(
    "SELECT * FROM agent_roles WHERE workspace_id = $1 AND agent_id = $2 AND role = 'owner'",
    [workspaceId, agentId]
  );
}

export async function canView(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const role = await getAgentRole(workspaceId, agentId, userId);
  return AGENT_ROLE_HIERARCHY[role] >= AGENT_ROLE_HIERARCHY['viewer'];
}

export async function canInteract(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const role = await getAgentRole(workspaceId, agentId, userId);
  return AGENT_ROLE_HIERARCHY[role] >= AGENT_ROLE_HIERARCHY['member'];
}

// ── Role Hierarchy Checks ──

export function hasMinimumRole(userRole: AccessRole, requiredRole: AccessRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function hasMinimumAgentRole(userRole: AgentAccessLevel, requiredRole: AgentAccessLevel): boolean {
  return AGENT_ROLE_HIERARCHY[userRole] >= AGENT_ROLE_HIERARCHY[requiredRole];
}

// ── Backward Compatible Shims ──

export async function isSuperadmin(workspaceId: string, userId: string): Promise<boolean> {
  const role = await getPlatformRole(workspaceId, userId);
  return role === 'superadmin';
}

export async function initSuperadmin(workspaceId: string, userId: string): Promise<boolean> {
  const existing = await queryOne(
    "SELECT user_id FROM platform_roles WHERE workspace_id = $1 AND role = 'superadmin' LIMIT 1",
    [workspaceId]
  );
  if (existing) return false; // Already initialized

  await setPlatformRole(workspaceId, userId, 'superadmin', 'system');
  logger.info('Superadmin initialized', { workspaceId, userId });
  return true;
}

export async function addSuperadmin(workspaceId: string, userId: string, grantedBy: string): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, grantedBy))) {
    throw new Error('Only superadmins can add other superadmins');
  }

  await setPlatformRole(workspaceId, userId, 'superadmin', grantedBy);
  logger.info('Superadmin added', { workspaceId, userId, grantedBy });
}

export async function removeSuperadmin(workspaceId: string, userId: string, removedBy: string): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, removedBy))) {
    throw new Error('Only superadmins can remove other superadmins');
  }

  await removePlatformRole(workspaceId, userId, removedBy);
  logger.info('Superadmin removed', { workspaceId, userId, removedBy });
}

export async function listSuperadmins(workspaceId: string): Promise<Superadmin[]> {
  const rows = await query<PlatformRoleRecord>(
    "SELECT * FROM platform_roles WHERE workspace_id = $1 AND role = 'superadmin'",
    [workspaceId]
  );
  return rows.map(r => ({
    user_id: r.user_id,
    granted_by: r.granted_by,
    granted_at: r.granted_at,
  }));
}

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

  const agentRole: AgentAccessLevel = role === 'admin' ? 'member' : 'owner';
  await setAgentRole(workspaceId, agentId, userId, agentRole, grantedBy);
  logger.info('Agent admin added', { agentId, userId, role, grantedBy });
}

export async function removeAgentAdmin(workspaceId: string, agentId: string, userId: string, removedBy: string): Promise<void> {
  if (!(await canModifyAgent(workspaceId, agentId, removedBy))) {
    throw new Error('Insufficient permissions to remove agent admin');
  }

  await removeAgentRole(workspaceId, agentId, userId);
  logger.info('Agent admin removed', { agentId, userId, removedBy });
}

export async function getAgentAdmins(workspaceId: string, agentId: string): Promise<AgentAdmin[]> {
  const rows = await query<AgentRoleRecord>(
    "SELECT * FROM agent_roles WHERE agent_id = $1 AND role IN ('owner', 'member')",
    [agentId]
  );
  return rows.map(r => ({
    agent_id: r.agent_id,
    user_id: r.user_id,
    role: r.role === 'owner' ? 'owner' as const : 'admin' as const,
    granted_by: r.granted_by,
    granted_at: r.granted_at,
  }));
}

// ── Role Resolution ──

export async function getUserRole(workspaceId: string, agentId: string, userId: string): Promise<AccessRole> {
  const platformRole = await getPlatformRole(workspaceId, userId);
  if (platformRole === 'superadmin') return 'superadmin';

  const agentRole = await getAgentRole(workspaceId, agentId, userId);
  if (agentRole === 'owner') return 'owner';
  if (agentRole === 'member') return 'admin';

  return 'member';
}

export async function canModifyAgent(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const agentRole = await getAgentRole(workspaceId, agentId, userId);
  return agentRole === 'owner';
}

export async function canSendTask(workspaceId: string, agentId: string, userId: string): Promise<boolean> {
  const { canAccessAgent } = await import('../agents');
  return canAccessAgent(workspaceId, agentId, userId);
}

// ── Upgrade Request Management ──

export async function requestUpgrade(workspaceId: string, agentId: string, userId: string, reason?: string): Promise<string> {
  const id = uuid();
  await execute(
    `INSERT INTO upgrade_requests (id, workspace_id, agent_id, user_id, requested_role, reason, status, created_at)
     VALUES ($1, $2, $3, $4, 'member', $5, 'pending', NOW())`,
    [id, workspaceId, agentId, userId, reason || null]
  );
  logger.info('Upgrade request created', { id, workspaceId, agentId, userId });

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: userId,
      actorRole: 'user',
      actionType: 'role_change',
      agentId,
      details: { action: 'upgrade_requested', requestedRole: 'member' },
    });
  }).catch(() => {});

  return id;
}

export async function approveUpgrade(workspaceId: string, requestId: string, approvedBy: string): Promise<UpgradeRequest | null> {
  const req = await queryOne<UpgradeRequest>(
    'SELECT * FROM upgrade_requests WHERE id = $1 AND workspace_id = $2 AND status = $3',
    [requestId, workspaceId, 'pending']
  );
  if (!req) return null;

  await execute(
    'UPDATE upgrade_requests SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3',
    ['approved', approvedBy, requestId]
  );

  // Grant the requested role
  await setAgentRole(workspaceId, req.agent_id, req.user_id, 'member', approvedBy);

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: approvedBy,
      actorRole: 'user',
      actionType: 'upgrade_approved',
      agentId: req.agent_id,
      targetUserId: req.user_id,
    });
  }).catch(() => {});

  return { ...req, status: 'approved', resolved_by: approvedBy };
}

export async function denyUpgrade(workspaceId: string, requestId: string, deniedBy: string): Promise<void> {
  const req = await queryOne<UpgradeRequest>(
    'SELECT * FROM upgrade_requests WHERE id = $1 AND workspace_id = $2 AND status = $3',
    [requestId, workspaceId, 'pending']
  );
  if (!req) return;

  await execute(
    'UPDATE upgrade_requests SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3',
    ['denied', deniedBy, requestId]
  );

  // Fire-and-forget audit
  import('../audit').then(({ logAuditEvent }) => {
    logAuditEvent({
      workspaceId,
      actorUserId: deniedBy,
      actorRole: 'user',
      actionType: 'upgrade_denied',
      agentId: req.agent_id,
      targetUserId: req.user_id,
    });
  }).catch(() => {});
}

export async function getUpgradeRequest(workspaceId: string, requestId: string): Promise<UpgradeRequest | null> {
  const result = await queryOne<UpgradeRequest>(
    'SELECT * FROM upgrade_requests WHERE workspace_id = $1 AND id = $2',
    [workspaceId, requestId]
  );
  return result || null;
}

export async function getPendingUpgradeRequest(workspaceId: string, agentId: string, userId: string): Promise<UpgradeRequest | null> {
  const result = await queryOne<UpgradeRequest>(
    "SELECT * FROM upgrade_requests WHERE workspace_id = $1 AND agent_id = $2 AND user_id = $3 AND status = 'pending'",
    [workspaceId, agentId, userId]
  );
  return result || null;
}

// ── Tool Access Requests ──

export interface ToolRequest {
  id: string;
  workspace_id: string;
  agent_id: string;
  tool_name: string;
  access_level: string;
  reason: string | null;
  status: string;
  requested_by: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function createToolRequest(
  workspaceId: string, agentId: string, toolName: string,
  accessLevel: string, userId: string, reason?: string,
): Promise<string> {
  const id = uuid();
  await execute(
    `INSERT INTO tool_requests (id, workspace_id, agent_id, tool_name, access_level, reason, status, requested_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())`,
    [id, workspaceId, agentId, toolName, accessLevel, reason || null, userId]
  );
  logger.info('Tool request created', { id, workspaceId, agentId, toolName });
  return id;
}

export async function listToolRequests(workspaceId: string, status?: string): Promise<ToolRequest[]> {
  if (status) {
    return query('SELECT * FROM tool_requests WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC', [workspaceId, status]);
  }
  return query('SELECT * FROM tool_requests WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId]);
}

export async function listAgentToolRequests(workspaceId: string, agentId: string): Promise<ToolRequest[]> {
  return query('SELECT * FROM tool_requests WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC', [workspaceId, agentId]);
}

export async function approveToolRequest(workspaceId: string, requestId: string, approvedBy: string): Promise<ToolRequest | null> {
  const req = await queryOne<ToolRequest>(
    "SELECT * FROM tool_requests WHERE id = $1 AND workspace_id = $2 AND status = 'pending'",
    [requestId, workspaceId]
  );
  if (!req) return null;

  await execute(
    'UPDATE tool_requests SET status = $1, resolved_by = $2, resolved_at = NOW() WHERE id = $3',
    ['approved', approvedBy, requestId]
  );

  // Add the tool to the agent
  const { addToolToAgent } = await import('../tools');
  await addToolToAgent(workspaceId, req.agent_id, req.tool_name, approvedBy);

  logger.info('Tool request approved', { requestId, toolName: req.tool_name, agentId: req.agent_id });
  return { ...req, status: 'approved', resolved_by: approvedBy };
}

export async function denyToolRequest(workspaceId: string, requestId: string, deniedBy: string): Promise<void> {
  const req = await queryOne<ToolRequest>(
    "SELECT * FROM tool_requests WHERE id = $1 AND workspace_id = $2 AND status = 'pending'",
    [requestId, workspaceId]
  );
  if (!req) return;

  await execute(
    "UPDATE tool_requests SET status = 'denied', resolved_by = $1, resolved_at = NOW() WHERE id = $2 AND workspace_id = $3 AND status = 'pending'",
    [deniedBy, requestId, workspaceId]
  );

  // Cleanup on denial
  try {
    if (req.tool_name.endsWith('-write')) {
      // Write tool denied: remove the tool from the agent entirely
      const { removeToolFromAgent } = await import('../tools');
      await removeToolFromAgent(workspaceId, req.agent_id, req.tool_name, deniedBy);
    }
    // For all tools (including write): remove the agent_tool_connections row
    await execute(
      'DELETE FROM agent_tool_connections WHERE workspace_id = $1 AND agent_id = $2 AND tool_name = $3',
      [workspaceId, req.agent_id, req.tool_name]
    );
  } catch (err: any) {
    logger.warn('Denial cleanup failed', { requestId, error: err.message });
  }

  logger.info('Tool request denied', { requestId, toolName: req.tool_name, agentId: req.agent_id });
}
