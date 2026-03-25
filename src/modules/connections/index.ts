import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { encrypt, decrypt } from './crypto';
import type { Connection, AgentToolConnection, ConnectionMode, PlatformRole, AgentAccessLevel } from '../../types';
import { logger } from '../../utils/logger';
import type { CredentialErrorContext } from './errors';

// ── Connection CRUD ──

export async function createTeamConnection(
  wsId: string,
  integrationId: string,
  credentials: Record<string, string>,
  createdBy: string,
  label?: string,
): Promise<Connection> {
  const { encrypted, iv } = encrypt(JSON.stringify(credentials));
  const id = uuid();

  const row = await queryOne<Connection>(`
    INSERT INTO connections (id, workspace_id, integration_id, connection_type, user_id, label, credentials_encrypted, credentials_iv, created_by)
    VALUES ($1, $2, $3, 'team', NULL, $4, $5, $6, $7)
    ON CONFLICT (workspace_id, integration_id) WHERE connection_type = 'team'
    DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
      credentials_iv = EXCLUDED.credentials_iv, label = EXCLUDED.label, status = 'active', updated_at = NOW()
    RETURNING *
  `, [id, wsId, integrationId, label || '', encrypted, iv, createdBy]);

  // Fire-and-forget audit
  try {
    const { logAuditEvent } = await import('../audit');
    logAuditEvent({
      workspaceId: wsId,
      actorUserId: createdBy,
      actorRole: 'admin',
      actionType: 'connection_created',
      connectionId: row!.id,
      details: { integrationId, type: 'team' },
    });
  } catch { /* best-effort */ }

  logger.info('Team connection created', { wsId, integrationId });
  return row!;
}

export async function createPersonalConnection(
  wsId: string,
  integrationId: string,
  userId: string,
  credentials: Record<string, string>,
  label?: string,
): Promise<Connection> {
  const { encrypted, iv } = encrypt(JSON.stringify(credentials));
  const id = uuid();

  const row = await queryOne<Connection>(`
    INSERT INTO connections (id, workspace_id, integration_id, connection_type, user_id, label, credentials_encrypted, credentials_iv, created_by)
    VALUES ($1, $2, $3, 'personal', $4, $5, $6, $7, $4)
    ON CONFLICT (workspace_id, integration_id, user_id) WHERE connection_type = 'personal'
    DO UPDATE SET credentials_encrypted = EXCLUDED.credentials_encrypted,
      credentials_iv = EXCLUDED.credentials_iv, label = EXCLUDED.label, status = 'active', updated_at = NOW()
    RETURNING *
  `, [id, wsId, integrationId, userId, label || '', encrypted, iv]);

  // Fire-and-forget audit
  try {
    const { logAuditEvent } = await import('../audit');
    logAuditEvent({
      workspaceId: wsId,
      actorUserId: userId,
      actorRole: 'user',
      actionType: 'connection_created',
      connectionId: row!.id,
      details: { integrationId, type: 'personal' },
    });
  } catch { /* best-effort */ }

  logger.info('Personal connection created', { wsId, integrationId, userId });
  return row!;
}

export async function getConnection(wsId: string, id: string): Promise<Connection | null> {
  const row = await queryOne<Connection>(
    'SELECT * FROM connections WHERE workspace_id = $1 AND id = $2',
    [wsId, id]
  );
  return row || null;
}

export async function getTeamConnection(wsId: string, integrationId: string): Promise<Connection | null> {
  const row = await queryOne<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND integration_id = $2 AND connection_type = 'team' AND status = 'active'",
    [wsId, integrationId]
  );
  return row || null;
}

export async function getPersonalConnection(wsId: string, integrationId: string, userId: string): Promise<Connection | null> {
  const row = await queryOne<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND integration_id = $2 AND user_id = $3 AND connection_type = 'personal' AND status = 'active'",
    [wsId, integrationId, userId]
  );
  return row || null;
}

export async function getUserConnections(wsId: string, userId: string): Promise<Connection[]> {
  return query<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND (user_id = $2 OR connection_type = 'team') AND status = 'active' ORDER BY created_at DESC",
    [wsId, userId]
  );
}

export async function deleteConnection(wsId: string, id: string): Promise<void> {
  await execute(
    "UPDATE connections SET status = 'revoked', updated_at = NOW() WHERE workspace_id = $1 AND id = $2",
    [wsId, id]
  );

  // Fire-and-forget audit
  try {
    const { logAuditEvent } = await import('../audit');
    logAuditEvent({
      workspaceId: wsId,
      actorUserId: 'system',
      actorRole: 'system',
      actionType: 'connection_deleted',
      connectionId: id,
    });
  } catch { /* best-effort */ }

  logger.info('Connection deleted (soft)', { wsId, id });
}

export function decryptCredentials(conn: Connection): Record<string, string> {
  return JSON.parse(decrypt(conn.credentials_encrypted, conn.credentials_iv));
}

// ── Agent Tool Connections ──

export async function setAgentToolConnection(
  wsId: string,
  agentId: string,
  toolName: string,
  mode: string,
  connectionId: string | null,
  configuredBy: string,
): Promise<AgentToolConnection> {
  const id = uuid();
  const row = await queryOne<AgentToolConnection>(`
    INSERT INTO agent_tool_connections (id, workspace_id, agent_id, tool_name, connection_mode, connection_id, configured_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (agent_id, tool_name)
    DO UPDATE SET connection_mode = EXCLUDED.connection_mode, connection_id = EXCLUDED.connection_id,
      configured_by = EXCLUDED.configured_by
    RETURNING *
  `, [id, wsId, agentId, toolName, mode, connectionId, configuredBy]);
  return row!;
}

export async function getAgentToolConnection(
  wsId: string,
  agentId: string,
  toolName: string,
): Promise<AgentToolConnection | null> {
  const row = await queryOne<AgentToolConnection>(
    'SELECT * FROM agent_tool_connections WHERE workspace_id = $1 AND agent_id = $2 AND tool_name = $3',
    [wsId, agentId, toolName]
  );
  return row || null;
}

// ── Query Helpers ──

export async function listTeamConnections(wsId: string): Promise<Connection[]> {
  return query<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND connection_type = 'team' AND status = 'active' ORDER BY created_at DESC",
    [wsId]
  );
}

export async function listPersonalConnectionsForUser(wsId: string, userId: string): Promise<Connection[]> {
  return query<Connection>(
    "SELECT * FROM connections WHERE workspace_id = $1 AND user_id = $2 AND connection_type = 'personal' AND status = 'active' ORDER BY created_at DESC",
    [wsId, userId]
  );
}

export async function getToolAgentUsage(wsId: string): Promise<Array<{ agent_id: string; agent_name: string; tool_name: string; access_level: string; connection_mode: string | null }>> {
  return query(
    `SELECT a.id AS agent_id, a.name AS agent_name, t.tool_name,
            COALESCE(ct.access_level, 'read-only') AS access_level,
            atc.connection_mode
     FROM agents a
     CROSS JOIN LATERAL json_array_elements_text(CASE WHEN a.tools IS NOT NULL AND a.tools != '' THEN a.tools::json ELSE '[]'::json END) AS t(tool_name)
     LEFT JOIN custom_tools ct ON ct.name = t.tool_name AND ct.workspace_id = a.workspace_id
     LEFT JOIN agent_tool_connections atc ON atc.agent_id = a.id AND atc.tool_name = t.tool_name AND atc.workspace_id = a.workspace_id
     WHERE a.workspace_id = $1 AND a.status = 'active'
     ORDER BY a.name, t.tool_name`,
    [wsId]
  );
}

export async function listAgentToolConnections(wsId: string, agentId: string): Promise<AgentToolConnection[]> {
  return query<AgentToolConnection>(
    'SELECT * FROM agent_tool_connections WHERE workspace_id = $1 AND agent_id = $2 ORDER BY tool_name',
    [wsId, agentId]
  );
}

// ── Credential Resolution ──

/**
 * Resolve integration ID from a tool name using manifest-based lookup.
 * Falls back to splitting on '-' if no manifest matches.
 */
export function getIntegrationIdForTool(toolName: string): string {
  try {
    const { getIntegrations } = require('../tools/integrations');
    const manifests = getIntegrations();
    for (const m of manifests) {
      if (m.tools.some((t: any) => t.name === toolName)) {
        return m.id;
      }
    }
  } catch { /* fallback below */ }
  return toolName.split('-')[0];
}

export async function resolveToolCredentials(
  wsId: string,
  agentId: string,
  toolName: string,
  userId?: string,
): Promise<Record<string, string> | null> {
  const atc = await getAgentToolConnection(wsId, agentId, toolName);
  const integrationId = getIntegrationIdForTool(toolName);

  if (atc) {
    switch (atc.connection_mode) {
      case 'team': {
        const conn = await getTeamConnection(wsId, integrationId);
        if (conn) return decryptCredentials(conn);
        break;
      }
      case 'delegated': {
        // Find first agent owner's personal connection
        const { getAgentOwners } = await import('../access-control');
        const owners = await getAgentOwners(wsId, agentId);
        for (const owner of owners) {
          const conn = await getPersonalConnection(wsId, integrationId, owner.user_id);
          if (conn) return decryptCredentials(conn);
        }
        break;
      }
      case 'runtime': {
        if (userId) {
          const conn = await getPersonalConnection(wsId, integrationId, userId);
          if (conn) return decryptCredentials(conn);
        }
        break;
      }
    }
  }

  // If no explicit mode set, default to team connection
  if (!atc) {
    const teamConn = await getTeamConnection(wsId, integrationId);
    if (teamConn) return decryptCredentials(teamConn);
  }

  return null;
}

export async function getCredentialErrorContext(
  wsId: string,
  agentId: string,
  toolName: string,
  runnerId: string,
): Promise<CredentialErrorContext> {
  const atc = await getAgentToolConnection(wsId, agentId, toolName);
  const integrationId = getIntegrationIdForTool(toolName);

  let integrationLabel = integrationId;
  let integrationIcon = ':wrench:';
  try {
    const { getIntegration } = require('../tools/integrations');
    const manifest = getIntegration(integrationId);
    if (manifest) {
      integrationLabel = manifest.label;
      integrationIcon = manifest.icon;
    }
  } catch { /* best-effort */ }

  const { getPlatformRole, getAgentRole, getAgentOwners } = await import('../access-control');
  const platformRole: PlatformRole = await getPlatformRole(wsId, runnerId);
  const agentRole: AgentAccessLevel = await getAgentRole(wsId, agentId, runnerId);
  const owners = await getAgentOwners(wsId, agentId);
  const ownerIds = owners.map(o => o.user_id);
  const isAdmin = platformRole === 'superadmin' || platformRole === 'admin';

  return {
    mode: (atc?.connection_mode as ConnectionMode) || null,
    integrationId,
    integrationLabel,
    integrationIcon,
    runnerPlatformRole: platformRole,
    runnerAgentRole: agentRole,
    agentOwnerIds: ownerIds,
    isRunnerOwner: agentRole === 'owner',
    isRunnerAdmin: isAdmin,
  };
}
