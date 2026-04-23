export function friendlyModel(model: string | null | undefined): string {
  if (!model) return 'Unknown';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  return 'Sonnet';
}

export function friendlyAgentStatus(status: string | null | undefined): string {
  switch (status) {
    case 'active': return 'Running';
    case 'paused': return 'Paused';
    case 'archived': return 'Archived';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

export function friendlyKbSourceStatus(status: string | null | undefined): string {
  switch (status) {
    case 'active': return 'Active';
    case 'syncing': return 'Syncing';
    case 'error': return 'Error';
    case 'needs_setup': return 'Setup needed';
    default: return 'Unknown';
  }
}

export function friendlyRunStatus(status: string | null | undefined): string {
  switch (status) {
    case 'completed':
    case 'success': return 'Completed';
    case 'failed':
    case 'error':
    case 'failure': return 'Failed';
    case 'running':
    case 'in_progress': return 'Running';
    case 'queued':
    case 'pending': return 'Queued';
    case 'timeout': return 'Timed out';
    default: return 'Unknown';
  }
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  tool_invocation: 'Tool invoked',
  agent_config_change: 'Agent configuration updated',
  role_change: 'Role changed',
  connection_created: 'Connection added',
  connection_deleted: 'Connection removed',
  upgrade_approved: 'Access upgrade approved',
  upgrade_denied: 'Access upgrade denied',
  agent_created: 'Agent created',
  agent_deleted: 'Agent deleted',
  platform_role_changed: 'Platform role changed',
};

export function friendlyAuditAction(actionType: string | null | undefined): string {
  if (!actionType) return 'Unknown action';
  return AUDIT_ACTION_LABELS[actionType] || actionType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function friendlyAuditStatus(status: string | null | undefined): string {
  switch (status) {
    case 'success': return 'Succeeded';
    case 'failure': return 'Failed';
    case 'error': return 'Failed';
    default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
  }
}
