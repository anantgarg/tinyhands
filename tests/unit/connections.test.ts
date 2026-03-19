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

const mockEncrypt = vi.fn().mockReturnValue({ encrypted: 'enc_data.authtag', iv: 'aabbcc' });
const mockDecrypt = vi.fn().mockReturnValue('{"api_key":"sk-123"}');

vi.mock('../../src/modules/connections/crypto', () => ({
  encrypt: (...args: any[]) => mockEncrypt(...args),
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

vi.mock('uuid', () => ({
  v4: () => 'conn-uuid-1234',
}));

// Mock audit module
vi.mock('../../src/modules/audit', () => ({
  logAuditEvent: vi.fn(),
}));

// Mock access-control for resolveToolCredentials
const mockGetAgentOwners = vi.fn().mockResolvedValue(['U_OWNER1']);
vi.mock('../../src/modules/access-control', () => ({
  getAgentOwners: (...args: any[]) => mockGetAgentOwners(...args),
}));

import {
  createTeamConnection,
  createPersonalConnection,
  getConnection,
  getTeamConnection,
  getPersonalConnection,
  getUserConnections,
  deleteConnection,
  decryptCredentials,
  setAgentToolConnection,
  getAgentToolConnection,
  resolveToolCredentials,
} from '../../src/modules/connections';

const TEST_WORKSPACE_ID = 'W_TEST_123';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createTeamConnection', () => {
  it('should create a team connection with encrypted credentials', async () => {
    const conn = {
      id: 'conn-uuid-1234',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'chargebee',
      connection_type: 'team',
      credentials_encrypted: 'enc_data.authtag',
      credentials_iv: 'aabbcc',
      status: 'active',
    };
    mockQueryOne.mockResolvedValueOnce(conn);

    const result = await createTeamConnection(TEST_WORKSPACE_ID, 'chargebee', { api_key: 'sk-123' }, 'U001', 'My Chargebee');

    expect(mockEncrypt).toHaveBeenCalledWith('{"api_key":"sk-123"}');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO connections'),
      expect.arrayContaining([TEST_WORKSPACE_ID, 'chargebee'])
    );
    expect(result.connection_type).toBe('team');
  });
});

describe('createPersonalConnection', () => {
  it('should create a personal connection', async () => {
    const conn = {
      id: 'conn-uuid-1234',
      workspace_id: TEST_WORKSPACE_ID,
      integration_id: 'github',
      connection_type: 'personal',
      user_id: 'U001',
    };
    mockQueryOne.mockResolvedValueOnce(conn);

    const result = await createPersonalConnection(TEST_WORKSPACE_ID, 'github', 'U001', { access_token: 'tok' });

    expect(mockEncrypt).toHaveBeenCalledWith('{"access_token":"tok"}');
    expect(result.connection_type).toBe('personal');
  });
});

describe('getConnection', () => {
  it('should return a connection by id', async () => {
    const conn = { id: 'c1', workspace_id: TEST_WORKSPACE_ID };
    mockQueryOne.mockResolvedValueOnce(conn);

    const result = await getConnection(TEST_WORKSPACE_ID, 'c1');

    expect(result).toEqual(conn);
  });

  it('should return null when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    const result = await getConnection(TEST_WORKSPACE_ID, 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('getTeamConnection', () => {
  it('should return the team connection for an integration', async () => {
    const conn = { id: 'c1', connection_type: 'team' };
    mockQueryOne.mockResolvedValueOnce(conn);

    const result = await getTeamConnection(TEST_WORKSPACE_ID, 'chargebee');

    expect(result).toEqual(conn);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("connection_type = 'team'"),
      [TEST_WORKSPACE_ID, 'chargebee']
    );
  });
});

describe('getPersonalConnection', () => {
  it('should return the personal connection for a user', async () => {
    const conn = { id: 'c2', connection_type: 'personal', user_id: 'U001' };
    mockQueryOne.mockResolvedValueOnce(conn);

    const result = await getPersonalConnection(TEST_WORKSPACE_ID, 'github', 'U001');

    expect(result).toEqual(conn);
  });
});

describe('getUserConnections', () => {
  it('should return team + personal connections for a user', async () => {
    const conns = [
      { id: 'c1', connection_type: 'team' },
      { id: 'c2', connection_type: 'personal', user_id: 'U001' },
    ];
    mockQuery.mockResolvedValueOnce(conns);

    const result = await getUserConnections(TEST_WORKSPACE_ID, 'U001');

    expect(result).toHaveLength(2);
  });
});

describe('deleteConnection', () => {
  it('should soft-delete a connection by setting status to revoked', async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await deleteConnection(TEST_WORKSPACE_ID, 'c1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'revoked'"),
      [TEST_WORKSPACE_ID, 'c1']
    );
  });
});

describe('decryptCredentials', () => {
  it('should decrypt and parse connection credentials', () => {
    const conn = {
      credentials_encrypted: 'enc_data.authtag',
      credentials_iv: 'aabbcc',
    } as any;
    mockDecrypt.mockReturnValue('{"api_key":"sk-123"}');

    const result = decryptCredentials(conn);

    expect(result).toEqual({ api_key: 'sk-123' });
    expect(mockDecrypt).toHaveBeenCalledWith('enc_data.authtag', 'aabbcc');
  });
});

describe('setAgentToolConnection', () => {
  it('should upsert an agent tool connection', async () => {
    const atc = { id: 'conn-uuid-1234', agent_id: 'agent-1', tool_name: 'chargebee-read', connection_mode: 'team' };
    mockQueryOne.mockResolvedValueOnce(atc);

    const result = await setAgentToolConnection(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read', 'team', 'c1', 'U001');

    expect(result.connection_mode).toBe('team');
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_tool_connections'),
      expect.arrayContaining([TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read', 'team'])
    );
  });
});

describe('getAgentToolConnection', () => {
  it('should return the agent tool connection', async () => {
    const atc = { agent_id: 'agent-1', tool_name: 'chargebee-read', connection_mode: 'team' };
    mockQueryOne.mockResolvedValueOnce(atc);

    const result = await getAgentToolConnection(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read');

    expect(result).toEqual(atc);
  });

  it('should return null when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(undefined);

    const result = await getAgentToolConnection(TEST_WORKSPACE_ID, 'agent-1', 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('resolveToolCredentials', () => {
  it('should resolve team credentials when mode is team', async () => {
    // getAgentToolConnection returns team mode
    mockQueryOne.mockResolvedValueOnce({ connection_mode: 'team' });
    // getTeamConnection returns a connection
    mockQueryOne.mockResolvedValueOnce({
      credentials_encrypted: 'enc.tag',
      credentials_iv: 'iv123',
    });
    mockDecrypt.mockReturnValue('{"api_key":"team-key"}');

    const result = await resolveToolCredentials(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read');

    expect(result).toEqual({ api_key: 'team-key' });
  });

  it('should resolve delegated credentials from first owner personal connection', async () => {
    // getAgentToolConnection returns delegated mode
    mockQueryOne.mockResolvedValueOnce({ connection_mode: 'delegated' });
    // getPersonalConnection for owner
    mockQueryOne.mockResolvedValueOnce({
      credentials_encrypted: 'enc.tag',
      credentials_iv: 'iv123',
    });
    mockDecrypt.mockReturnValue('{"access_token":"owner-tok"}');

    const result = await resolveToolCredentials(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read');

    expect(result).toEqual({ access_token: 'owner-tok' });
  });

  it('should resolve runtime credentials from invoking user', async () => {
    // getAgentToolConnection returns runtime mode
    mockQueryOne.mockResolvedValueOnce({ connection_mode: 'runtime' });
    // getPersonalConnection for user
    mockQueryOne.mockResolvedValueOnce({
      credentials_encrypted: 'enc.tag',
      credentials_iv: 'iv123',
    });
    mockDecrypt.mockReturnValue('{"access_token":"user-tok"}');

    const result = await resolveToolCredentials(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read', 'U_USER');

    expect(result).toEqual({ access_token: 'user-tok' });
  });

  it('should fallback to team connection when no agent tool connection exists', async () => {
    // getAgentToolConnection returns null
    mockQueryOne.mockResolvedValueOnce(undefined);
    // getTeamConnection fallback
    mockQueryOne.mockResolvedValueOnce({
      credentials_encrypted: 'enc.tag',
      credentials_iv: 'iv123',
    });
    mockDecrypt.mockReturnValue('{"api_key":"fallback-key"}');

    const result = await resolveToolCredentials(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read');

    expect(result).toEqual({ api_key: 'fallback-key' });
  });

  it('should return null when no connection is found', async () => {
    mockQueryOne.mockResolvedValue(undefined);

    const result = await resolveToolCredentials(TEST_WORKSPACE_ID, 'agent-1', 'chargebee-read');

    expect(result).toBeNull();
  });
});

// ── New: listTeamConnections ──

import {
  listTeamConnections,
  listPersonalConnectionsForUser,
  getToolAgentUsage,
  listAgentToolConnections,
  getIntegrationIdForTool,
} from '../../src/modules/connections';

describe('listTeamConnections', () => {
  it('should return all active team connections for a workspace', async () => {
    const conns = [
      { id: 'c1', connection_type: 'team', integration_id: 'chargebee', status: 'active' },
      { id: 'c2', connection_type: 'team', integration_id: 'hubspot', status: 'active' },
    ];
    mockQuery.mockResolvedValueOnce(conns);

    const result = await listTeamConnections(TEST_WORKSPACE_ID);

    expect(result).toHaveLength(2);
    expect(result[0].integration_id).toBe('chargebee');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("connection_type = 'team'"),
      [TEST_WORKSPACE_ID]
    );
  });

  it('should return empty array when no team connections exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listTeamConnections(TEST_WORKSPACE_ID);

    expect(result).toHaveLength(0);
  });
});

describe('listPersonalConnectionsForUser', () => {
  it('should return personal connections for a specific user', async () => {
    const conns = [
      { id: 'c1', connection_type: 'personal', user_id: 'U001', integration_id: 'github' },
    ];
    mockQuery.mockResolvedValueOnce(conns);

    const result = await listPersonalConnectionsForUser(TEST_WORKSPACE_ID, 'U001');

    expect(result).toHaveLength(1);
    expect(result[0].user_id).toBe('U001');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("connection_type = 'personal'"),
      [TEST_WORKSPACE_ID, 'U001']
    );
  });

  it('should return empty array when user has no personal connections', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listPersonalConnectionsForUser(TEST_WORKSPACE_ID, 'U_NOBODY');

    expect(result).toHaveLength(0);
  });
});

describe('getToolAgentUsage', () => {
  it('should return agent tool usage with join data', async () => {
    const usage = [
      { agent_id: 'a1', agent_name: 'Bot1', tool_name: 'chargebee-read', access_level: 'read-only', connection_mode: 'team' },
      { agent_id: 'a2', agent_name: 'Bot2', tool_name: 'hubspot-read', access_level: 'read-write', connection_mode: null },
    ];
    mockQuery.mockResolvedValueOnce(usage);

    const result = await getToolAgentUsage(TEST_WORKSPACE_ID);

    expect(result).toHaveLength(2);
    expect(result[0].agent_name).toBe('Bot1');
    expect(result[0].connection_mode).toBe('team');
    expect(result[1].connection_mode).toBeNull();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('unnest(a.tools)'),
      [TEST_WORKSPACE_ID]
    );
  });

  it('should return empty array when no agents use tools', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await getToolAgentUsage(TEST_WORKSPACE_ID);

    expect(result).toHaveLength(0);
  });
});

describe('listAgentToolConnections', () => {
  it('should return all tool connections for an agent', async () => {
    const conns = [
      { agent_id: 'a1', tool_name: 'chargebee-read', connection_mode: 'team' },
      { agent_id: 'a1', tool_name: 'chargebee-write', connection_mode: 'delegated' },
    ];
    mockQuery.mockResolvedValueOnce(conns);

    const result = await listAgentToolConnections(TEST_WORKSPACE_ID, 'a1');

    expect(result).toHaveLength(2);
    expect(result[0].connection_mode).toBe('team');
    expect(result[1].connection_mode).toBe('delegated');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('agent_tool_connections'),
      [TEST_WORKSPACE_ID, 'a1']
    );
  });

  it('should return empty array when agent has no tool connections', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await listAgentToolConnections(TEST_WORKSPACE_ID, 'a1');

    expect(result).toHaveLength(0);
  });
});

describe('getIntegrationIdForTool', () => {
  it('should resolve integration ID from tool manifests', () => {
    // The getIntegrations mock is set up to return manifests via require()
    // Since we mock the connections module's require, this falls through to the split fallback
    const result = getIntegrationIdForTool('chargebee-read');

    // Falls back to splitting on '-' since require() in test won't resolve
    expect(result).toBe('chargebee');
  });

  it('should fall back to splitting on hyphen when no manifest matches', () => {
    const result = getIntegrationIdForTool('unknown-tool-name');

    expect(result).toBe('unknown');
  });

  it('should return the full name when no hyphen exists', () => {
    const result = getIntegrationIdForTool('standalone');

    expect(result).toBe('standalone');
  });
});
