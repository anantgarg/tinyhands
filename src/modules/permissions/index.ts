import type { IntegrationAccess } from '../../types';

// ── Integration Access ──

const INTEGRATION_ACTIONS: Record<IntegrationAccess, string[]> = {
  read: ['query', 'search', 'retrieve', 'list', 'get'],
  write: ['query', 'search', 'retrieve', 'list', 'get', 'create', 'update', 'post'],
  admin: ['query', 'search', 'retrieve', 'list', 'get', 'create', 'update', 'post', 'delete', 'configure', 'manage'],
};

export function isActionAllowed(level: IntegrationAccess, action: string): boolean {
  return INTEGRATION_ACTIONS[level]?.includes(action) ?? false;
}

export function validateIntegrationAccess(level: string): level is IntegrationAccess {
  return ['read', 'write', 'admin'].includes(level);
}
