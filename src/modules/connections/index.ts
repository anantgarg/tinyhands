import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { encrypt, decrypt } from './crypto';
import type { Connection, AgentToolConnection } from '../../types';
import { logger } from '../../utils/logger';

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
      credentials_iv = EXCLUDED.credentials_iv, label = EXCLUDED.label, updated_at = NOW()
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
      credentials_iv = EXCLUDED.credentials_iv, label = EXCLUDED.label, updated_at = NOW()
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

// ── Credential Resolution ──

export async function resolveToolCredentials(
  wsId: string,
  agentId: string,
  toolName: string,
  userId?: string,
): Promise<Record<string, string> | null> {
  const atc = await getAgentToolConnection(wsId, agentId, toolName);

  if (atc) {
    switch (atc.connection_mode) {
      case 'team': {
        // Find the integration from toolName (e.g. "chargebee-read" → "chargebee")
        const integrationId = toolName.split('-')[0];
        const conn = await getTeamConnection(wsId, integrationId);
        if (conn) return decryptCredentials(conn);
        break;
      }
      case 'delegated': {
        // Find first agent owner's personal connection
        const { getAgentOwners } = await import('../access-control');
        const owners = await getAgentOwners(wsId, agentId);
        const integrationId = toolName.split('-')[0];
        for (const owner of owners) {
          const conn = await getPersonalConnection(wsId, integrationId, owner.user_id);
          if (conn) return decryptCredentials(conn);
        }
        break;
      }
      case 'runtime': {
        if (userId) {
          const integrationId = toolName.split('-')[0];
          const conn = await getPersonalConnection(wsId, integrationId, userId);
          if (conn) return decryptCredentials(conn);
        }
        break;
      }
    }
  }

  // Fallback: try team connection for integration
  const integrationId = toolName.split('-')[0];
  const teamConn = await getTeamConnection(wsId, integrationId);
  if (teamConn) return decryptCredentials(teamConn);

  return null;
}
