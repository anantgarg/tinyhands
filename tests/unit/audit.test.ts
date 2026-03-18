import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: () => 'audit-uuid-1234',
}));

import { logAuditEvent, getAuditLog } from '../../src/modules/audit';

const TEST_WORKSPACE_ID = 'W_TEST_123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('logAuditEvent', () => {
  it('should insert an audit event', () => {
    mockExecute.mockResolvedValue(undefined);

    logAuditEvent({
      workspaceId: TEST_WORKSPACE_ID,
      actorUserId: 'U001',
      actorRole: 'admin',
      actionType: 'agent_created',
      agentId: 'agent-1',
      agentName: 'TestAgent',
    });

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO action_audit_log'),
      expect.arrayContaining(['audit-uuid-1234', TEST_WORKSPACE_ID, 'U001', 'admin', 'agent_created'])
    );
  });

  it('should not throw when execute fails', () => {
    mockExecute.mockRejectedValue(new Error('DB error'));

    // Should not throw
    expect(() => {
      logAuditEvent({
        workspaceId: TEST_WORKSPACE_ID,
        actorUserId: 'U001',
        actorRole: 'admin',
        actionType: 'agent_created',
      });
    }).not.toThrow();
  });

  it('should serialize details as JSON', () => {
    mockExecute.mockResolvedValue(undefined);

    logAuditEvent({
      workspaceId: TEST_WORKSPACE_ID,
      actorUserId: 'U001',
      actorRole: 'user',
      actionType: 'agent_config_change',
      details: { field: 'name', oldValue: 'old', newValue: 'new' },
    });

    const callArgs = mockExecute.mock.calls[0][1];
    expect(callArgs).toContain('{"field":"name","oldValue":"old","newValue":"new"}');
  });

  it('should use default values for optional params', () => {
    mockExecute.mockResolvedValue(undefined);

    logAuditEvent({
      workspaceId: TEST_WORKSPACE_ID,
      actorUserId: 'U001',
      actorRole: 'user',
      actionType: 'role_change',
    });

    const callArgs = mockExecute.mock.calls[0][1];
    // Check nulls for optional fields
    expect(callArgs).toContain(null); // agentId
    expect(callArgs).toContain('success'); // default status
  });
});

describe('getAuditLog', () => {
  it('should return audit entries for a workspace', async () => {
    const entries = [
      { id: '1', workspace_id: TEST_WORKSPACE_ID, action_type: 'agent_created', actor_user_id: 'U001' },
    ];
    mockQuery.mockResolvedValue(entries);

    const result = await getAuditLog(TEST_WORKSPACE_ID);

    expect(result).toEqual(entries);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM action_audit_log'),
      expect.arrayContaining([TEST_WORKSPACE_ID, 50, 0])
    );
  });

  it('should filter by agentId', async () => {
    mockQuery.mockResolvedValue([]);

    await getAuditLog(TEST_WORKSPACE_ID, { agentId: 'agent-1' });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('agent_id = $2');
    expect(mockQuery.mock.calls[0][1]).toContain('agent-1');
  });

  it('should filter by userId', async () => {
    mockQuery.mockResolvedValue([]);

    await getAuditLog(TEST_WORKSPACE_ID, { userId: 'U001' });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('actor_user_id = $2');
    expect(mockQuery.mock.calls[0][1]).toContain('U001');
  });

  it('should filter by actionType', async () => {
    mockQuery.mockResolvedValue([]);

    await getAuditLog(TEST_WORKSPACE_ID, { actionType: 'role_change' });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('action_type = $2');
    expect(mockQuery.mock.calls[0][1]).toContain('role_change');
  });

  it('should apply limit and offset', async () => {
    mockQuery.mockResolvedValue([]);

    await getAuditLog(TEST_WORKSPACE_ID, { limit: 10, offset: 20 });

    const params = mockQuery.mock.calls[0][1];
    expect(params).toContain(10);
    expect(params).toContain(20);
  });

  it('should return empty array when no entries exist', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await getAuditLog(TEST_WORKSPACE_ID);

    expect(result).toEqual([]);
  });

  it('should combine multiple filters', async () => {
    mockQuery.mockResolvedValue([]);

    await getAuditLog(TEST_WORKSPACE_ID, { agentId: 'agent-1', userId: 'U001', actionType: 'tool_invocation' });

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('agent_id = $2');
    expect(sql).toContain('actor_user_id = $3');
    expect(sql).toContain('action_type = $4');
  });
});
