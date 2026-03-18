import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  // New platform role functions
  getPlatformRole,
  setPlatformRole,
  removePlatformRole,
  listPlatformAdmins,
  isPlatformAdmin,
  // New agent role functions
  getAgentRole,
  setAgentRole,
  removeAgentRole,
  getAgentRoles,
  getAgentOwners,
  canView,
  canInteract,
  // New role hierarchy
  hasMinimumAgentRole,
  // Backward compat shims
  initSuperadmin,
  addSuperadmin,
  removeSuperadmin,
  isSuperadmin,
  listSuperadmins,
  addAgentAdmin,
  removeAgentAdmin,
  getAgentAdmins,
  getUserRole,
  canModifyAgent,
  canSendTask,
  hasMinimumRole,
} from '../../src/modules/access-control';

const TEST_WORKSPACE_ID = 'W_TEST_123';

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
});

// ── getPlatformRole ──

describe('getPlatformRole', () => {
  it('should return the platform role when found', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: TEST_WORKSPACE_ID, user_id: 'U1', role: 'superadmin', granted_by: 'system', granted_at: '2025-01-01' });

    const role = await getPlatformRole(TEST_WORKSPACE_ID, 'U1');

    expect(role).toBe('superadmin');
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
      [TEST_WORKSPACE_ID, 'U1']
    );
  });

  it('should return member when no platform role found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const role = await getPlatformRole(TEST_WORKSPACE_ID, 'U_NOBODY');

    expect(role).toBe('member');
  });

  it('should return admin role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const role = await getPlatformRole(TEST_WORKSPACE_ID, 'U_ADMIN');

    expect(role).toBe('admin');
  });
});

// ── setPlatformRole ──

describe('setPlatformRole', () => {
  it('should upsert a platform role', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await setPlatformRole(TEST_WORKSPACE_ID, 'U1', 'superadmin', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_roles'),
      [TEST_WORKSPACE_ID, 'U1', 'superadmin', 'U_GRANTER']
    );
  });
});

// ── removePlatformRole ──

describe('removePlatformRole', () => {
  it('should remove a non-superadmin role', async () => {
    // COUNT superadmins
    mockQueryOne.mockResolvedValueOnce({ count: '2' });
    // getPlatformRole for the user being removed
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removePlatformRole(TEST_WORKSPACE_ID, 'U_ADMIN', 'U_REMOVER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
      [TEST_WORKSPACE_ID, 'U_ADMIN']
    );
  });

  it('should remove a superadmin when count > 1', async () => {
    // COUNT superadmins
    mockQueryOne.mockResolvedValueOnce({ count: '2' });
    // getPlatformRole for the user being removed
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removePlatformRole(TEST_WORKSPACE_ID, 'U_SUPER', 'U_REMOVER');

    expect(mockExecute).toHaveBeenCalled();
  });

  it('should throw when trying to remove the last superadmin', async () => {
    // COUNT superadmins = 1
    mockQueryOne.mockResolvedValueOnce({ count: '1' });
    // getPlatformRole for user being removed = superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    await expect(removePlatformRole(TEST_WORKSPACE_ID, 'U_LAST', 'U_REMOVER'))
      .rejects.toThrow('Cannot remove the last superadmin');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should handle null count', async () => {
    // COUNT returns null
    mockQueryOne.mockResolvedValueOnce(null);
    // getPlatformRole
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    await expect(removePlatformRole(TEST_WORKSPACE_ID, 'U_LAST', 'U_REMOVER'))
      .rejects.toThrow('Cannot remove the last superadmin');
  });
});

// ── listPlatformAdmins ──

describe('listPlatformAdmins', () => {
  it('should return superadmins and admins', async () => {
    const admins = [
      { workspace_id: TEST_WORKSPACE_ID, user_id: 'U1', role: 'superadmin', granted_by: 'system', granted_at: '2025-01-01' },
      { workspace_id: TEST_WORKSPACE_ID, user_id: 'U2', role: 'admin', granted_by: 'U1', granted_at: '2025-01-02' },
    ];
    mockQuery.mockResolvedValueOnce(admins);

    const result = await listPlatformAdmins(TEST_WORKSPACE_ID);

    expect(result).toEqual(admins);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("role IN ('superadmin', 'admin')"),
      [TEST_WORKSPACE_ID]
    );
  });

  it('should return empty array when no admins exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listPlatformAdmins(TEST_WORKSPACE_ID);

    expect(result).toEqual([]);
  });
});

// ── isPlatformAdmin ──

describe('isPlatformAdmin', () => {
  it('should return true for superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await isPlatformAdmin(TEST_WORKSPACE_ID, 'U_SUPER');

    expect(result).toBe(true);
  });

  it('should return true for admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const result = await isPlatformAdmin(TEST_WORKSPACE_ID, 'U_ADMIN');

    expect(result).toBe(true);
  });

  it('should return false for member', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await isPlatformAdmin(TEST_WORKSPACE_ID, 'U_MEMBER');

    expect(result).toBe(false);
  });
});

// ── getAgentRole ──

describe('getAgentRole', () => {
  it('should return owner for platform superadmin', async () => {
    // getPlatformRole
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_SUPER');

    expect(role).toBe('owner');
    // Should not query agent_roles when user is platform admin
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('should return owner for platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_ADMIN');

    expect(role).toBe('owner');
  });

  it('should return explicit agent role when found', async () => {
    // getPlatformRole: member
    mockQueryOne.mockResolvedValueOnce(null);
    // agent_roles query
    mockQueryOne.mockResolvedValueOnce({ agent_id: 'agent_1', user_id: 'U1', role: 'member' });

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(role).toBe('member');
  });

  it('should return agent owner role', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' }); // agent_roles

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_OWNER');

    expect(role).toBe('owner');
  });

  it('should fall back to agent default_access when no explicit role', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce({ default_access: 'viewer' }); // agent default

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_NOBODY');

    expect(role).toBe('viewer');
  });

  it('should return none for agent with default_access none', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce({ default_access: 'none' }); // agent default

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_NOBODY');

    expect(role).toBe('none');
  });

  it('should default to viewer when agent has no default_access', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce(null); // agent not found

    const role = await getAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U_NOBODY');

    expect(role).toBe('viewer');
  });
});

// ── setAgentRole ──

describe('setAgentRole', () => {
  it('should upsert an agent role', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await setAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U1', 'member', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_roles'),
      ['agent_1', 'U1', 'member', 'U_GRANTER', TEST_WORKSPACE_ID]
    );
  });
});

// ── removeAgentRole ──

describe('removeAgentRole', () => {
  it('should remove an agent role', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await removeAgentRole(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM agent_roles WHERE agent_id = $1 AND user_id = $2',
      ['agent_1', 'U1']
    );
  });
});

// ── getAgentRoles ──

describe('getAgentRoles', () => {
  it('should return all roles for an agent', async () => {
    const roles = [
      { agent_id: 'agent_1', user_id: 'U1', role: 'owner', granted_by: 'U1', granted_at: '2025-01-01', workspace_id: TEST_WORKSPACE_ID },
      { agent_id: 'agent_1', user_id: 'U2', role: 'member', granted_by: 'U1', granted_at: '2025-01-02', workspace_id: TEST_WORKSPACE_ID },
    ];
    mockQuery.mockResolvedValueOnce(roles);

    const result = await getAgentRoles(TEST_WORKSPACE_ID, 'agent_1');

    expect(result).toEqual(roles);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM agent_roles WHERE workspace_id = $1 AND agent_id = $2',
      [TEST_WORKSPACE_ID, 'agent_1']
    );
  });

  it('should return empty array when no roles exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await getAgentRoles(TEST_WORKSPACE_ID, 'agent_1');

    expect(result).toEqual([]);
  });
});

// ── getAgentOwners ──

describe('getAgentOwners', () => {
  it('should return only owner roles', async () => {
    const owners = [
      { agent_id: 'agent_1', user_id: 'U1', role: 'owner', granted_by: 'U1', granted_at: '2025-01-01', workspace_id: TEST_WORKSPACE_ID },
    ];
    mockQuery.mockResolvedValueOnce(owners);

    const result = await getAgentOwners(TEST_WORKSPACE_ID, 'agent_1');

    expect(result).toEqual(owners);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("role = 'owner'"),
      [TEST_WORKSPACE_ID, 'agent_1']
    );
  });
});

// ── canView ──

describe('canView', () => {
  it('should return true for viewer role', async () => {
    // getPlatformRole
    mockQueryOne.mockResolvedValueOnce(null);
    // agent_roles
    mockQueryOne.mockResolvedValueOnce({ role: 'viewer' });

    const result = await canView(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(true);
  });

  it('should return true for member role', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ role: 'member' });

    const result = await canView(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(true);
  });

  it('should return true for owner role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await canView(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(true);
  });

  it('should return false for none role', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ default_access: 'none' });

    const result = await canView(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(false);
  });
});

// ── canInteract ──

describe('canInteract', () => {
  it('should return true for member role', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ role: 'member' });

    const result = await canInteract(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(true);
  });

  it('should return false for viewer role', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ role: 'viewer' });

    const result = await canInteract(TEST_WORKSPACE_ID, 'agent_1', 'U1');

    expect(result).toBe(false);
  });

  it('should return true for owner (platform admin)', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await canInteract(TEST_WORKSPACE_ID, 'agent_1', 'U_SUPER');

    expect(result).toBe(true);
  });
});

// ── hasMinimumRole (backward compat) ──

describe('hasMinimumRole', () => {
  it('should return true when user role matches required role exactly', () => {
    expect(hasMinimumRole('member', 'member')).toBe(true);
    expect(hasMinimumRole('admin', 'admin')).toBe(true);
    expect(hasMinimumRole('owner', 'owner')).toBe(true);
    expect(hasMinimumRole('superadmin', 'superadmin')).toBe(true);
  });

  it('should return true when user role exceeds required role', () => {
    expect(hasMinimumRole('superadmin', 'member')).toBe(true);
    expect(hasMinimumRole('superadmin', 'admin')).toBe(true);
    expect(hasMinimumRole('superadmin', 'owner')).toBe(true);
    expect(hasMinimumRole('owner', 'admin')).toBe(true);
    expect(hasMinimumRole('owner', 'member')).toBe(true);
    expect(hasMinimumRole('admin', 'member')).toBe(true);
  });

  it('should return false when user role is below required role', () => {
    expect(hasMinimumRole('member', 'admin')).toBe(false);
    expect(hasMinimumRole('member', 'owner')).toBe(false);
    expect(hasMinimumRole('member', 'superadmin')).toBe(false);
    expect(hasMinimumRole('admin', 'owner')).toBe(false);
    expect(hasMinimumRole('admin', 'superadmin')).toBe(false);
    expect(hasMinimumRole('owner', 'superadmin')).toBe(false);
  });

  it('should respect the full hierarchy: superadmin > owner > admin > member', () => {
    const roles = ['member', 'admin', 'owner', 'superadmin'] as const;

    for (let i = 0; i < roles.length; i++) {
      for (let j = 0; j < roles.length; j++) {
        const expected = i >= j;
        expect(hasMinimumRole(roles[i], roles[j])).toBe(expected);
      }
    }
  });
});

// ── hasMinimumAgentRole ──

describe('hasMinimumAgentRole', () => {
  it('should compare agent roles correctly', () => {
    expect(hasMinimumAgentRole('owner', 'viewer')).toBe(true);
    expect(hasMinimumAgentRole('member', 'viewer')).toBe(true);
    expect(hasMinimumAgentRole('viewer', 'viewer')).toBe(true);
    expect(hasMinimumAgentRole('none', 'viewer')).toBe(false);
    expect(hasMinimumAgentRole('viewer', 'member')).toBe(false);
    expect(hasMinimumAgentRole('member', 'owner')).toBe(false);
    expect(hasMinimumAgentRole('owner', 'owner')).toBe(true);
    expect(hasMinimumAgentRole('none', 'none')).toBe(true);
  });
});

// ── Backward Compat: isSuperadmin ──

describe('isSuperadmin', () => {
  it('should return true when user has superadmin platform role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await isSuperadmin(TEST_WORKSPACE_ID, 'U_SUPER');

    expect(result).toBe(true);
  });

  it('should return false when user has admin platform role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const result = await isSuperadmin(TEST_WORKSPACE_ID, 'U_ADMIN');

    expect(result).toBe(false);
  });

  it('should return false when user has no platform role', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await isSuperadmin(TEST_WORKSPACE_ID, 'U_NOBODY');

    expect(result).toBe(false);
  });
});

// ── Backward Compat: initSuperadmin ──

describe('initSuperadmin', () => {
  it('should create superadmin when none exist', async () => {
    // Check for existing superadmin
    mockQueryOne.mockResolvedValueOnce(null);
    // setPlatformRole calls execute
    mockExecute.mockResolvedValueOnce(undefined);

    const result = await initSuperadmin(TEST_WORKSPACE_ID, 'U_FIRST');

    expect(result).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledWith(
      "SELECT user_id FROM platform_roles WHERE workspace_id = $1 AND role = 'superadmin' LIMIT 1",
      [TEST_WORKSPACE_ID]
    );
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_roles'),
      [TEST_WORKSPACE_ID, 'U_FIRST', 'superadmin', 'system']
    );
  });

  it('should return false when a superadmin already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_EXISTING' });

    const result = await initSuperadmin(TEST_WORKSPACE_ID, 'U_NEW');

    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── Backward Compat: addSuperadmin ──

describe('addSuperadmin', () => {
  it('should add a superadmin when grantedBy is a platform admin', async () => {
    // isPlatformAdmin -> getPlatformRole
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    // setPlatformRole
    mockExecute.mockResolvedValueOnce(undefined);

    await addSuperadmin(TEST_WORKSPACE_ID, 'U_NEW', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_roles'),
      [TEST_WORKSPACE_ID, 'U_NEW', 'superadmin', 'U_GRANTER']
    );
  });

  it('should throw when grantedBy is not a platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin

    await expect(addSuperadmin(TEST_WORKSPACE_ID, 'U_NEW', 'U_NOBODY')).rejects.toThrow(
      'Only superadmins can add other superadmins'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── Backward Compat: removeSuperadmin ──

describe('removeSuperadmin', () => {
  it('should remove a superadmin when removedBy is a platform admin', async () => {
    // isPlatformAdmin -> getPlatformRole
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    // removePlatformRole -> COUNT
    mockQueryOne.mockResolvedValueOnce({ count: '2' });
    // removePlatformRole -> getPlatformRole for the target user
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removeSuperadmin(TEST_WORKSPACE_ID, 'U_TARGET', 'U_REMOVER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM platform_roles WHERE workspace_id = $1 AND user_id = $2',
      [TEST_WORKSPACE_ID, 'U_TARGET']
    );
  });

  it('should throw when removedBy is not a platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    await expect(removeSuperadmin(TEST_WORKSPACE_ID, 'U_TARGET', 'U_NOBODY')).rejects.toThrow(
      'Only superadmins can remove other superadmins'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should throw when trying to remove the last superadmin', async () => {
    // isPlatformAdmin
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    // COUNT superadmins = 1
    mockQueryOne.mockResolvedValueOnce({ count: '1' });
    // getPlatformRole for user being removed
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    await expect(removeSuperadmin(TEST_WORKSPACE_ID, 'U_LAST', 'U_LAST')).rejects.toThrow(
      'Cannot remove the last superadmin'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── Backward Compat: listSuperadmins ──

describe('listSuperadmins', () => {
  it('should return all superadmins from platform_roles', async () => {
    const rows = [
      { workspace_id: TEST_WORKSPACE_ID, user_id: 'U1', role: 'superadmin', granted_by: 'system', granted_at: '2025-01-01' },
      { workspace_id: TEST_WORKSPACE_ID, user_id: 'U2', role: 'superadmin', granted_by: 'U1', granted_at: '2025-01-02' },
    ];
    mockQuery.mockResolvedValueOnce(rows);

    const result = await listSuperadmins(TEST_WORKSPACE_ID);

    expect(result).toEqual([
      { user_id: 'U1', granted_by: 'system', granted_at: '2025-01-01' },
      { user_id: 'U2', granted_by: 'U1', granted_at: '2025-01-02' },
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("role = 'superadmin'"),
      [TEST_WORKSPACE_ID]
    );
  });

  it('should return empty array when no superadmins exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listSuperadmins(TEST_WORKSPACE_ID);

    expect(result).toEqual([]);
  });
});

// ── Backward Compat: addAgentAdmin ──

describe('addAgentAdmin', () => {
  it('should add an agent admin when grantedBy has modify permissions', async () => {
    // canModifyAgent -> getAgentRole -> getPlatformRole = superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    // setAgentRole calls execute
    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin(TEST_WORKSPACE_ID, 'agent_1', 'U_NEW', 'admin', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_roles'),
      ['agent_1', 'U_NEW', 'member', 'U_GRANTER', TEST_WORKSPACE_ID]
    );
  });

  it('should add owner role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin(TEST_WORKSPACE_ID, 'agent_1', 'U_NEW', 'owner', 'U_SUPER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_roles'),
      ['agent_1', 'U_NEW', 'owner', 'U_SUPER', TEST_WORKSPACE_ID]
    );
  });

  it('should throw when grantedBy is a regular member', async () => {
    // canModifyAgent -> getAgentRole -> getPlatformRole = member
    mockQueryOne.mockResolvedValueOnce(null);
    // getAgentRole -> agent_roles
    mockQueryOne.mockResolvedValueOnce(null);
    // getAgentRole -> agent default_access
    mockQueryOne.mockResolvedValueOnce({ default_access: 'viewer' });

    await expect(
      addAgentAdmin(TEST_WORKSPACE_ID, 'agent_1', 'U_NEW', 'admin', 'U_MEMBER')
    ).rejects.toThrow('Insufficient permissions to add agent admin');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── Backward Compat: removeAgentAdmin ──

describe('removeAgentAdmin', () => {
  it('should remove an agent admin when removedBy has modify permissions', async () => {
    // canModifyAgent -> getAgentRole -> getPlatformRole = superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });
    // removeAgentRole calls execute
    mockExecute.mockResolvedValueOnce(undefined);

    await removeAgentAdmin(TEST_WORKSPACE_ID, 'agent_1', 'U_TARGET', 'U_SUPER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM agent_roles WHERE agent_id = $1 AND user_id = $2',
      ['agent_1', 'U_TARGET']
    );
  });

  it('should throw when removedBy is a regular member', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce({ default_access: 'viewer' }); // default

    await expect(
      removeAgentAdmin(TEST_WORKSPACE_ID, 'agent_1', 'U_TARGET', 'U_MEMBER')
    ).rejects.toThrow('Insufficient permissions to remove agent admin');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── Backward Compat: getAgentAdmins ──

describe('getAgentAdmins', () => {
  it('should return agent roles as admins format', async () => {
    const roles = [
      { agent_id: 'agent_1', user_id: 'U1', role: 'owner', granted_by: 'system', granted_at: '2025-01-01', workspace_id: TEST_WORKSPACE_ID },
      { agent_id: 'agent_1', user_id: 'U2', role: 'member', granted_by: 'U1', granted_at: '2025-01-02', workspace_id: TEST_WORKSPACE_ID },
    ];
    mockQuery.mockResolvedValueOnce(roles);

    const result = await getAgentAdmins(TEST_WORKSPACE_ID, 'agent_1');

    expect(result).toEqual([
      { agent_id: 'agent_1', user_id: 'U1', role: 'owner', granted_by: 'system', granted_at: '2025-01-01' },
      { agent_id: 'agent_1', user_id: 'U2', role: 'admin', granted_by: 'U1', granted_at: '2025-01-02' },
    ]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("role IN ('owner', 'member')"),
      ['agent_1']
    );
  });

  it('should return an empty array when agent has no admins', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await getAgentAdmins(TEST_WORKSPACE_ID, 'agent_nonexistent');

    expect(result).toEqual([]);
  });
});

// ── getUserRole ──

describe('getUserRole', () => {
  it('should return superadmin if user has superadmin platform role', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const role = await getUserRole(TEST_WORKSPACE_ID, 'agent_1', 'U_SUPER');

    expect(role).toBe('superadmin');
  });

  it('should return owner if user has owner agent role', async () => {
    // getPlatformRole: member
    mockQueryOne.mockResolvedValueOnce(null);
    // getAgentRole -> getPlatformRole again (within getAgentRole)
    mockQueryOne.mockResolvedValueOnce(null);
    // getAgentRole -> agent_roles
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' });

    const role = await getUserRole(TEST_WORKSPACE_ID, 'agent_1', 'U_OWNER');

    expect(role).toBe('owner');
  });

  it('should return admin if user has member agent role', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce(null); // getPlatformRole in getAgentRole
    mockQueryOne.mockResolvedValueOnce({ role: 'member' }); // agent_roles = member

    const role = await getUserRole(TEST_WORKSPACE_ID, 'agent_1', 'U_MEMBER_ROLE');

    expect(role).toBe('admin');
  });

  it('should return member if user has only viewer access', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce(null); // getPlatformRole in getAgentRole
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce({ default_access: 'viewer' }); // default

    const role = await getUserRole(TEST_WORKSPACE_ID, 'agent_1', 'U_NOBODY');

    expect(role).toBe('member');
  });
});

// ── canModifyAgent ──

describe('canModifyAgent', () => {
  it('should return true for platform superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await canModifyAgent(TEST_WORKSPACE_ID, 'agent_1', 'U_SUPER');

    expect(result).toBe(true);
  });

  it('should return true for agent owner', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' }); // agent_roles = owner

    const result = await canModifyAgent(TEST_WORKSPACE_ID, 'agent_1', 'U_OWNER');

    expect(result).toBe(true);
  });

  it('should return false for agent member', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce({ role: 'member' }); // agent_roles = member

    const result = await canModifyAgent(TEST_WORKSPACE_ID, 'agent_1', 'U_MEMBER');

    expect(result).toBe(false);
  });

  it('should return false for viewer', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not platform admin
    mockQueryOne.mockResolvedValueOnce(null); // no agent_role
    mockQueryOne.mockResolvedValueOnce({ default_access: 'viewer' }); // default

    const result = await canModifyAgent(TEST_WORKSPACE_ID, 'agent_1', 'U_VIEWER');

    expect(result).toBe(false);
  });
});

// ── canSendTask ──

describe('canSendTask', () => {
  it('should delegate to canAccessAgent', async () => {
    // canAccessAgent -> getAgentRole -> getPlatformRole = superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'superadmin' });

    const result = await canSendTask(TEST_WORKSPACE_ID, 'agent_1', 'U_SUPER');

    expect(result).toBe(true);
  });
});
