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

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
});

// ── initSuperadmin ──

describe('initSuperadmin', () => {
  it('should insert superadmin when none exist', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no existing superadmin
    mockExecute.mockResolvedValueOnce(undefined);

    const result = await initSuperadmin('U_FIRST');

    expect(result).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledWith('SELECT user_id FROM superadmins LIMIT 1');
    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO superadmins (user_id, granted_by) VALUES ($1, $2)',
      ['U_FIRST', 'system']
    );
  });

  it('should return false and skip insert when a superadmin already exists', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_EXISTING' });

    const result = await initSuperadmin('U_NEW');

    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── isSuperadmin ──

describe('isSuperadmin', () => {
  it('should return true when user is a superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' });

    const result = await isSuperadmin('U_SUPER');

    expect(result).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT user_id FROM superadmins WHERE user_id = $1',
      ['U_SUPER']
    );
  });

  it('should return false when user is not a superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await isSuperadmin('U_NOBODY');

    expect(result).toBe(false);
  });

  it('should return false when queryOne returns undefined', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    const result = await isSuperadmin('U_NOBODY');

    expect(result).toBe(false);
  });
});

// ── addSuperadmin ──

describe('addSuperadmin', () => {
  it('should add a superadmin when grantedBy is a superadmin', async () => {
    // isSuperadmin check for grantedBy
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_GRANTER' });
    mockExecute.mockResolvedValueOnce(undefined);

    await addSuperadmin('U_NEW', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      'INSERT INTO superadmins (user_id, granted_by) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      ['U_NEW', 'U_GRANTER']
    );
  });

  it('should throw when grantedBy is not a superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // grantedBy is not superadmin

    await expect(addSuperadmin('U_NEW', 'U_NOBODY')).rejects.toThrow(
      'Only superadmins can add other superadmins'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should use ON CONFLICT DO NOTHING for duplicate inserts', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_GRANTER' });
    mockExecute.mockResolvedValueOnce(undefined);

    await addSuperadmin('U_EXISTING', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT DO NOTHING'),
      ['U_EXISTING', 'U_GRANTER']
    );
  });
});

// ── removeSuperadmin ──

describe('removeSuperadmin', () => {
  it('should remove a superadmin when removedBy is a superadmin and count > 1', async () => {
    // isSuperadmin check for removedBy
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_REMOVER' });
    // COUNT query
    mockQueryOne.mockResolvedValueOnce({ count: '3' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removeSuperadmin('U_TARGET', 'U_REMOVER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM superadmins WHERE user_id = $1',
      ['U_TARGET']
    );
  });

  it('should throw when removedBy is not a superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    await expect(removeSuperadmin('U_TARGET', 'U_NOBODY')).rejects.toThrow(
      'Only superadmins can remove other superadmins'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should throw when trying to remove the last superadmin', async () => {
    // isSuperadmin check — removedBy is superadmin
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_LAST' });
    // COUNT query — only 1 superadmin
    mockQueryOne.mockResolvedValueOnce({ count: '1' });

    await expect(removeSuperadmin('U_LAST', 'U_LAST')).rejects.toThrow(
      'Cannot remove the last superadmin'
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should throw when count is 0 (edge case)', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_REMOVER' });
    mockQueryOne.mockResolvedValueOnce({ count: '0' });

    await expect(removeSuperadmin('U_TARGET', 'U_REMOVER')).rejects.toThrow(
      'Cannot remove the last superadmin'
    );
  });

  it('should handle null count result gracefully', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_REMOVER' });
    mockQueryOne.mockResolvedValueOnce(null); // countResult is null

    await expect(removeSuperadmin('U_TARGET', 'U_REMOVER')).rejects.toThrow(
      'Cannot remove the last superadmin'
    );
  });

  it('should allow removal when exactly 2 superadmins exist', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_REMOVER' });
    mockQueryOne.mockResolvedValueOnce({ count: '2' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removeSuperadmin('U_OTHER', 'U_REMOVER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM superadmins WHERE user_id = $1',
      ['U_OTHER']
    );
  });
});

// ── listSuperadmins ──

describe('listSuperadmins', () => {
  it('should return all superadmins', async () => {
    const superadmins = [
      { user_id: 'U1', granted_by: 'system', granted_at: '2025-01-01' },
      { user_id: 'U2', granted_by: 'U1', granted_at: '2025-01-02' },
    ];
    mockQuery.mockResolvedValueOnce(superadmins);

    const result = await listSuperadmins();

    expect(result).toEqual(superadmins);
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM superadmins');
  });

  it('should return an empty array when no superadmins exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listSuperadmins();

    expect(result).toEqual([]);
  });
});

// ── addAgentAdmin ──

describe('addAgentAdmin', () => {
  it('should add an agent admin when grantedBy has modify permissions', async () => {
    // canModifyAgent → getUserRole → isSuperadmin
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_GRANTER' }); // is superadmin

    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin('agent_1', 'U_NEW', 'admin', 'U_GRANTER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_admins'),
      ['agent_1', 'U_NEW', 'admin', 'U_GRANTER']
    );
  });

  it('should add an owner-role agent admin', async () => {
    // grantedBy is superadmin
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' });
    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin('agent_1', 'U_OWNER', 'owner', 'U_SUPER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_admins'),
      ['agent_1', 'U_OWNER', 'owner', 'U_SUPER']
    );
  });

  it('should allow agent owner to add another admin', async () => {
    // canModifyAgent → getUserRole → isSuperadmin check returns false
    mockQueryOne.mockResolvedValueOnce(null);
    // getUserRole → agent_admins query returns owner
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' });

    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin('agent_1', 'U_NEW_ADMIN', 'admin', 'U_OWNER');

    expect(mockExecute).toHaveBeenCalled();
  });

  it('should allow existing agent admin to add another admin', async () => {
    // isSuperadmin check for grantedBy
    mockQueryOne.mockResolvedValueOnce(null);
    // getUserRole → agent_admins query returns admin
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin('agent_1', 'U_NEW', 'admin', 'U_ADMIN');

    expect(mockExecute).toHaveBeenCalled();
  });

  it('should throw when grantedBy is a regular member', async () => {
    // isSuperadmin: false
    mockQueryOne.mockResolvedValueOnce(null);
    // agent_admins: no record
    mockQueryOne.mockResolvedValueOnce(null);

    await expect(
      addAgentAdmin('agent_1', 'U_NEW', 'admin', 'U_MEMBER')
    ).rejects.toThrow('Insufficient permissions to add agent admin');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should upsert when adding an existing user (ON CONFLICT UPDATE)', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' }); // is superadmin
    mockExecute.mockResolvedValueOnce(undefined);

    await addAgentAdmin('agent_1', 'U_EXISTING', 'owner', 'U_SUPER');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (agent_id, user_id) DO UPDATE'),
      ['agent_1', 'U_EXISTING', 'owner', 'U_SUPER']
    );
  });
});

// ── removeAgentAdmin ──

describe('removeAgentAdmin', () => {
  it('should remove an agent admin when removedBy has modify permissions', async () => {
    // canModifyAgent → getUserRole → isSuperadmin
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removeAgentAdmin('agent_1', 'U_TARGET', 'U_SUPER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM agent_admins WHERE agent_id = $1 AND user_id = $2',
      ['agent_1', 'U_TARGET']
    );
  });

  it('should allow an agent owner to remove an admin', async () => {
    // isSuperadmin: false
    mockQueryOne.mockResolvedValueOnce(null);
    // getUserRole → agent_admins returns owner
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' });
    mockExecute.mockResolvedValueOnce(undefined);

    await removeAgentAdmin('agent_1', 'U_ADMIN', 'U_OWNER');

    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM agent_admins WHERE agent_id = $1 AND user_id = $2',
      ['agent_1', 'U_ADMIN']
    );
  });

  it('should throw when removedBy is a regular member', async () => {
    // isSuperadmin: false
    mockQueryOne.mockResolvedValueOnce(null);
    // getUserRole → agent_admins: no record (member)
    mockQueryOne.mockResolvedValueOnce(null);

    await expect(
      removeAgentAdmin('agent_1', 'U_TARGET', 'U_MEMBER')
    ).rejects.toThrow('Insufficient permissions to remove agent admin');
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── getAgentAdmins ──

describe('getAgentAdmins', () => {
  it('should return all admins for an agent', async () => {
    const admins = [
      { agent_id: 'agent_1', user_id: 'U1', role: 'owner', granted_by: 'system', granted_at: '2025-01-01' },
      { agent_id: 'agent_1', user_id: 'U2', role: 'admin', granted_by: 'U1', granted_at: '2025-01-02' },
    ];
    mockQuery.mockResolvedValueOnce(admins);

    const result = await getAgentAdmins('agent_1');

    expect(result).toEqual(admins);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM agent_admins WHERE agent_id = $1',
      ['agent_1']
    );
  });

  it('should return an empty array when agent has no admins', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await getAgentAdmins('agent_nonexistent');

    expect(result).toEqual([]);
  });
});

// ── getUserRole ──

describe('getUserRole', () => {
  it('should return superadmin if user is a superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' }); // isSuperadmin

    const role = await getUserRole('agent_1', 'U_SUPER');

    expect(role).toBe('superadmin');
    // Should not query agent_admins when user is superadmin
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });

  it('should return owner if user is an agent owner', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' }); // agent_admins

    const role = await getUserRole('agent_1', 'U_OWNER');

    expect(role).toBe('owner');
  });

  it('should return admin if user is an agent admin', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' }); // agent_admins

    const role = await getUserRole('agent_1', 'U_ADMIN');

    expect(role).toBe('admin');
  });

  it('should return member if user has no special role', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce(null); // not in agent_admins

    const role = await getUserRole('agent_1', 'U_NOBODY');

    expect(role).toBe('member');
  });

  it('should return member if agent_admins row has an unexpected role value', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'viewer' }); // unexpected role

    const role = await getUserRole('agent_1', 'U_VIEWER');

    expect(role).toBe('member');
  });

  it('should query the correct agent-user pair', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce(null);

    await getUserRole('agent_42', 'U_123');

    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT role FROM agent_admins WHERE agent_id = $1 AND user_id = $2',
      ['agent_42', 'U_123']
    );
  });
});

// ── canModifyAgent ──

describe('canModifyAgent', () => {
  it('should return true for superadmin', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U_SUPER' });

    const result = await canModifyAgent('agent_1', 'U_SUPER');

    expect(result).toBe(true);
  });

  it('should return true for agent owner', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'owner' });

    const result = await canModifyAgent('agent_1', 'U_OWNER');

    expect(result).toBe(true);
  });

  it('should return true for agent admin', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce({ role: 'admin' });

    const result = await canModifyAgent('agent_1', 'U_ADMIN');

    expect(result).toBe(true);
  });

  it('should return false for regular member', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // not superadmin
    mockQueryOne.mockResolvedValueOnce(null); // not in agent_admins

    const result = await canModifyAgent('agent_1', 'U_MEMBER');

    expect(result).toBe(false);
  });
});

// ── canSendTask ──

describe('canSendTask', () => {
  it('should always return true for any user', async () => {
    const result = await canSendTask('agent_1', 'U_ANYONE');

    expect(result).toBe(true);
  });

  it('should return true without making any DB calls', async () => {
    await canSendTask('agent_1', 'U_MEMBER');

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

// ── hasMinimumRole ──

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
    // Each role should satisfy itself and all lower roles, but not higher ones
    const roles = ['member', 'admin', 'owner', 'superadmin'] as const;

    for (let i = 0; i < roles.length; i++) {
      for (let j = 0; j < roles.length; j++) {
        const expected = i >= j;
        expect(hasMinimumRole(roles[i], roles[j])).toBe(expected);
      }
    }
  });
});
