import { describe, it, expect } from 'vitest';
import {
  getDisallowedTools,
  getAllowedTools,
  isActionAllowed,
  getDockerSecurityConfig,
  canElevatePermissions,
} from '../../src/modules/permissions';

describe('Tool Access (Axis 1)', () => {
  it('should restrict read-only agents from write tools', () => {
    const disallowed = getDisallowedTools('read-only');
    expect(disallowed).toContain('Bash');
    expect(disallowed).toContain('Write');
    expect(disallowed).toContain('Edit');
    expect(disallowed).toContain('NotebookEdit');
  });

  it('should only restrict NotebookEdit for standard agents', () => {
    const disallowed = getDisallowedTools('standard');
    expect(disallowed).toEqual(['NotebookEdit']);
  });

  it('should allow all tools for full permission', () => {
    const disallowed = getDisallowedTools('full');
    expect(disallowed).toHaveLength(0);
  });

  it('should filter agent tools correctly', () => {
    const agentTools = ['Read', 'Write', 'Bash', 'Glob'];
    const allowed = getAllowedTools('read-only', agentTools);
    expect(allowed).toEqual(['Read', 'Glob']);
  });
});

describe('Integration Access (Axis 2)', () => {
  it('should allow read operations for read level', () => {
    expect(isActionAllowed('read', 'query')).toBe(true);
    expect(isActionAllowed('read', 'search')).toBe(true);
    expect(isActionAllowed('read', 'create')).toBe(false);
  });

  it('should allow write operations for write level', () => {
    expect(isActionAllowed('write', 'create')).toBe(true);
    expect(isActionAllowed('write', 'update')).toBe(true);
    expect(isActionAllowed('write', 'delete')).toBe(false);
  });

  it('should allow all operations for admin level', () => {
    expect(isActionAllowed('admin', 'delete')).toBe(true);
    expect(isActionAllowed('admin', 'configure')).toBe(true);
    expect(isActionAllowed('admin', 'manage')).toBe(true);
  });
});

describe('Docker Isolation (Axis 3)', () => {
  it('should use no network for standard agents', () => {
    const config = getDockerSecurityConfig('standard');
    expect(config.networkMode).toBe('none');
    expect(config.noNewPrivileges).toBe(true);
  });

  it('should use bridge network for full agents', () => {
    const config = getDockerSecurityConfig('full');
    expect(config.networkMode).toBe('bridge');
  });

  it('should use read-only rootfs for read-only agents', () => {
    const config = getDockerSecurityConfig('read-only');
    expect(config.readOnlyRootfs).toBe(true);
  });
});

describe('Permission Elevation', () => {
  it('should not allow elevating beyond current level', () => {
    expect(canElevatePermissions('standard', 'full')).toBe(false);
    expect(canElevatePermissions('read-only', 'standard')).toBe(false);
  });

  it('should allow keeping same or lower level', () => {
    expect(canElevatePermissions('full', 'standard')).toBe(true);
    expect(canElevatePermissions('full', 'full')).toBe(true);
    expect(canElevatePermissions('standard', 'read-only')).toBe(true);
  });
});
