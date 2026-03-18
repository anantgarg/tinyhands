import { v4 as uuid } from 'uuid';
import { query, execute } from '../../db';
import type { AuditLogEntry, AuditActionType } from '../../types';
import { logger } from '../../utils/logger';

export interface LogAuditEventParams {
  workspaceId: string;
  actorUserId: string;
  actorRole: string;
  actionType: AuditActionType;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  connectionId?: string;
  targetUserId?: string;
  details?: Record<string, any>;
  runId?: string;
  traceId?: string;
  channelId?: string;
  status?: string;
  errorMessage?: string;
}

// Fire-and-forget audit logging
export function logAuditEvent(params: LogAuditEventParams): void {
  const id = uuid();
  execute(`
    INSERT INTO action_audit_log (id, workspace_id, actor_user_id, actor_role, action_type,
      agent_id, agent_name, tool_name, connection_id, target_user_id,
      details_json, run_id, trace_id, channel_id, status, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `, [
    id, params.workspaceId, params.actorUserId, params.actorRole, params.actionType,
    params.agentId || null, params.agentName || null, params.toolName || null,
    params.connectionId || null, params.targetUserId || null,
    JSON.stringify(params.details || {}), params.runId || null,
    params.traceId || null, params.channelId || null,
    params.status || 'success', params.errorMessage || null,
  ]).catch(err => {
    logger.warn('Failed to log audit event', { error: err.message, actionType: params.actionType });
  });
}

export async function getAuditLog(
  workspaceId: string,
  options?: {
    agentId?: string;
    userId?: string;
    actionType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<AuditLogEntry[]> {
  const conditions = ['workspace_id = $1'];
  const params: any[] = [workspaceId];
  let paramIdx = 2;

  if (options?.agentId) {
    conditions.push(`agent_id = $${paramIdx++}`);
    params.push(options.agentId);
  }
  if (options?.userId) {
    conditions.push(`actor_user_id = $${paramIdx++}`);
    params.push(options.userId);
  }
  if (options?.actionType) {
    conditions.push(`action_type = $${paramIdx++}`);
    params.push(options.actionType);
  }

  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  return query<AuditLogEntry>(
    `SELECT * FROM action_audit_log WHERE ${conditions.join(' AND ')} ORDER BY timestamp DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    [...params, limit, offset]
  );
}
