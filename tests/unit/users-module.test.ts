import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  upsertUser,
  getMembership,
  setMembership,
  listUserWorkspaces,
  isWorkspaceMember,
  isWorkspaceAdmin,
  setActiveWorkspace,
  addPlatformAdmin,
  isPlatformAdmin,
} from '../../src/modules/users';

describe('Users + Memberships + Platform Admins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upsertUser generates deterministic id from slack_user_id + home_workspace_id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'W1:U123', slack_user_id: 'U123', home_workspace_id: 'W1' });
    const user = await upsertUser({ slackUserId: 'U123', homeWorkspaceId: 'W1' });
    expect(user.id).toBe('W1:U123');
    // Second call gets ON CONFLICT DO UPDATE — id should still be same shape
    expect(mockQueryOne.mock.calls[0][1][0]).toBe('W1:U123');
  });

  it('getMembership returns the workspace membership row', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'W1', user_id: 'U1', role: 'admin', created_at: '', updated_at: '' });
    const m = await getMembership('W1', 'U1');
    expect(m?.role).toBe('admin');
  });

  it('getMembership returns null for non-members', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    const m = await getMembership('W2', 'U1');
    expect(m).toBeNull();
  });

  it('isWorkspaceMember / isWorkspaceAdmin use membership role', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'W1', user_id: 'U1', role: 'admin' });
    expect(await isWorkspaceAdmin('W1', 'U1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'W1', user_id: 'U1', role: 'member' });
    expect(await isWorkspaceAdmin('W1', 'U1')).toBe(false);
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'W1', user_id: 'U1', role: 'member' });
    expect(await isWorkspaceMember('W1', 'U1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await isWorkspaceMember('W1', 'U1')).toBe(false);
  });

  it('listUserWorkspaces returns joined workspace rows', async () => {
    mockQuery.mockResolvedValueOnce([
      { workspace_id: 'W1', role: 'admin', team_name: 'Acme', workspace_slug: 'acme' },
      { workspace_id: 'W2', role: 'member', team_name: 'Beta', workspace_slug: 'beta' },
    ]);
    const out = await listUserWorkspaces('U1');
    expect(out).toHaveLength(2);
    expect(out[0].team_name).toBe('Acme');
  });

  it('setMembership upserts a membership row', async () => {
    await setMembership('W1', 'U1', 'member');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workspace_memberships'),
      ['W1', 'U1', 'member'],
    );
  });

  it('setActiveWorkspace refuses to set to a workspace the user is not a member of', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);
    await expect(setActiveWorkspace('U1', 'W2')).rejects.toThrow(/not a member/);
  });

  it('setActiveWorkspace succeeds when user is a member', async () => {
    mockQueryOne.mockResolvedValueOnce({ workspace_id: 'W1', user_id: 'U1', role: 'admin' });
    await setActiveWorkspace('U1', 'W1');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET active_workspace_id'),
      ['W1', 'U1'],
    );
  });

  it('addPlatformAdmin inserts with ON CONFLICT DO NOTHING', async () => {
    await addPlatformAdmin('U1', 'a@b.com');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_admins'),
      ['U1', 'a@b.com'],
    );
  });

  it('isPlatformAdmin reads from platform_admins table', async () => {
    mockQueryOne.mockResolvedValueOnce({ user_id: 'U1' });
    expect(await isPlatformAdmin('U1')).toBe(true);
    mockQueryOne.mockResolvedValueOnce(undefined);
    expect(await isPlatformAdmin('U1')).toBe(false);
  });
});
