import type { PermissionLevel, IntegrationAccess } from '../../types';

// ── Axis 1: Tool Access ──

const TOOL_RESTRICTIONS: Record<PermissionLevel, string[]> = {
  'read-only': ['Bash', 'Write', 'Edit', 'NotebookEdit'],
  'standard': ['NotebookEdit'],
  'full': [],
};

export function getDisallowedTools(level: PermissionLevel): string[] {
  return TOOL_RESTRICTIONS[level] || [];
}

export function getAllowedTools(level: PermissionLevel, agentTools: string[]): string[] {
  const disallowed = new Set(getDisallowedTools(level));
  return agentTools.filter(t => !disallowed.has(t));
}

// ── Axis 2: Integration Access ──

const INTEGRATION_ACTIONS: Record<IntegrationAccess, string[]> = {
  read: ['query', 'search', 'retrieve', 'list', 'get'],
  write: ['query', 'search', 'retrieve', 'list', 'get', 'create', 'update', 'post'],
  admin: ['query', 'search', 'retrieve', 'list', 'get', 'create', 'update', 'post', 'delete', 'configure', 'manage'],
};

export function isActionAllowed(level: IntegrationAccess, action: string): boolean {
  return INTEGRATION_ACTIONS[level]?.includes(action) ?? false;
}

// ── Axis 3: Docker Isolation Config ──

export interface DockerSecurityConfig {
  networkMode: 'none' | 'bridge';
  readOnlyRootfs: boolean;
  noNewPrivileges: boolean;
  dropCapabilities: string[];
  memoryLimit: number;
  cpuLimit: number;
}

export function getDockerSecurityConfig(level: PermissionLevel): DockerSecurityConfig {
  const base: DockerSecurityConfig = {
    networkMode: 'bridge',
    readOnlyRootfs: false,
    noNewPrivileges: true,
    dropCapabilities: ['ALL'],
    memoryLimit: 2 * 1024 * 1024 * 1024, // 2GB
    cpuLimit: 1,
  };

  if (level === 'full') {
    return { ...base, networkMode: 'bridge' };
  }

  if (level === 'read-only') {
    return { ...base, readOnlyRootfs: true };
  }

  return base;
}

// ── Permission Validation ──

export function validatePermissionLevel(level: string): level is PermissionLevel {
  return ['read-only', 'standard', 'full'].includes(level);
}

export function validateIntegrationAccess(level: string): level is IntegrationAccess {
  return ['read', 'write', 'admin'].includes(level);
}

export function canElevatePermissions(
  currentLevel: PermissionLevel,
  targetLevel: PermissionLevel
): boolean {
  const hierarchy: PermissionLevel[] = ['read-only', 'standard', 'full'];
  return hierarchy.indexOf(targetLevel) <= hierarchy.indexOf(currentLevel);
}
