import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

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

const mockGetAgent = vi.fn();
const mockUpdateAgent = vi.fn();
vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
  updateAgent: (...args: any[]) => mockUpdateAgent(...args),
}));

const mockRegisterCustomTool = vi.fn();
vi.mock('../../src/modules/tools', () => ({
  registerCustomTool: (...args: any[]) => mockRegisterCustomTool(...args),
}));

const mockValidateArtifactPath = vi.fn();
const mockValidateToolName = vi.fn();
vi.mock('../../src/modules/self-authoring', () => ({
  validateArtifactPath: (...args: any[]) => mockValidateArtifactPath(...args),
  validateToolName: (...args: any[]) => mockValidateToolName(...args),
}));

const mockCreateKBEntry = vi.fn();
vi.mock('../../src/modules/knowledge-base', () => ({
  createKBEntry: (...args: any[]) => mockCreateKBEntry(...args),
}));

const mockCanModifyAgent = vi.fn();
vi.mock('../../src/modules/access-control', () => ({
  canModifyAgent: (...args: any[]) => mockCanModifyAgent(...args),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import {
  createProposal,
  approveProposal,
  rejectProposal,
  getProposal,
  getPendingProposals,
  getProposalHistory,
  expireOldProposals,
} from '../../src/modules/self-evolution';
import { logger } from '../../src/utils/logger';

// ── Helpers ──

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    name: 'test-agent',
    tools: ['Read', 'Write'],
    self_evolution_mode: 'approve-first',
    ...overrides,
  };
}

function makeProposal(overrides: Record<string, any> = {}) {
  return {
    id: 'proposal-1',
    agent_id: 'agent-1',
    action: 'write_tool' as const,
    description: 'Auto-authored tool: my-tool',
    diff: JSON.stringify({ name: 'my-tool', schema: {}, stored_in_db: true, code: 'console.log("hi")' }),
    status: 'pending' as const,
    created_at: '2025-01-01T00:00:00Z',
    resolved_at: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════
//  Tests
// ══════════════════════════════════════════════════

describe('Self-Evolution Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────
  //  createProposal
  // ────────────────────────────────────────────
  describe('createProposal', () => {
    it('creates a pending proposal in approve-first mode', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'approve-first' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      const proposal = await createProposal(
        'agent-1', 'write_tool', 'New tool', '{"name":"test"}'
      );

      expect(proposal.id).toBe('test-uuid-1234');
      expect(proposal.agent_id).toBe('agent-1');
      expect(proposal.action).toBe('write_tool');
      expect(proposal.description).toBe('New tool');
      expect(proposal.diff).toBe('{"name":"test"}');
      expect(proposal.status).toBe('pending');
      expect(proposal.resolved_at).toBeNull();
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO evolution_proposals'),
        expect.arrayContaining(['test-uuid-1234', 'agent-1', 'write_tool', 'New tool'])
      );
    });

    it('creates an executed proposal and auto-executes in autonomous mode', async () => {
      const toolDiff = JSON.stringify({ name: 'my-tool', schema: {}, stored_in_db: true, code: 'code' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 }); // INSERT

      const proposal = await createProposal('agent-1', 'write_tool', 'New tool', toolDiff);

      expect(proposal.status).toBe('executed');
      expect(proposal.resolved_at).not.toBeNull();
    });

    it('throws if agent not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(createProposal('nonexistent', 'write_tool', 'desc', '{}'))
        .rejects.toThrow('Agent nonexistent not found');
    });

    it('supports all action types', async () => {
      const actions = ['write_tool', 'create_mcp', 'commit_code', 'update_prompt', 'add_to_kb'] as const;

      for (const action of actions) {
        vi.clearAllMocks();
        mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'approve-first' }));
        mockExecute.mockResolvedValueOnce({ rowCount: 1 });

        const proposal = await createProposal('agent-1', action, `Test ${action}`, '{}');
        expect(proposal.action).toBe(action);
      }
    });

    it('auto-executes write_tool with stored_in_db flag (no re-register)', async () => {
      const diff = JSON.stringify({ name: 'tool-1', stored_in_db: true, code: 'code' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockValidateToolName.mockReturnValueOnce(undefined);

      const proposal = await createProposal('agent-1', 'write_tool', 'desc', diff);

      expect(proposal.status).toBe('executed');
      // Since stored_in_db is true, registerCustomTool should NOT be called
      expect(mockRegisterCustomTool).not.toHaveBeenCalled();
    });

    it('auto-executes write_tool without stored_in_db by registering', async () => {
      const diff = JSON.stringify({ name: 'new-tool', schema: {}, code: 'code', language: 'javascript' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockValidateToolName.mockReturnValueOnce(undefined);
      mockRegisterCustomTool.mockResolvedValueOnce({});

      const proposal = await createProposal('agent-1', 'write_tool', 'desc', diff);

      expect(proposal.status).toBe('executed');
      expect(mockRegisterCustomTool).toHaveBeenCalledWith(
        'new-tool',
        expect.any(String),
        null,
        'agent-1',
        expect.objectContaining({ code: 'code', language: 'javascript' })
      );
    });

    it('auto-executes create_mcp by inserting config', async () => {
      const diff = JSON.stringify({ name: 'linear-mcp', url: 'http://localhost:3001' });
      mockGetAgent
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }))
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })  // INSERT proposal
        .mockResolvedValueOnce({ rowCount: 1 }); // INSERT mcp_configs

      const proposal = await createProposal('agent-1', 'create_mcp', 'desc', diff);

      expect(proposal.status).toBe('executed');
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const secondCall = mockExecute.mock.calls[1];
      expect(secondCall[0]).toContain('INSERT INTO mcp_configs');
    });

    it('auto-executes update_prompt by calling updateAgent', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockUpdateAgent.mockResolvedValueOnce(undefined);

      const newPrompt = 'You are now an improved agent.';
      const proposal = await createProposal('agent-1', 'update_prompt', 'Update prompt', newPrompt);

      expect(proposal.status).toBe('executed');
      expect(mockUpdateAgent).toHaveBeenCalledWith(
        'agent-1',
        { system_prompt: newPrompt },
        'agent-1'
      );
    });

    it('auto-executes add_to_kb by creating KB entry', async () => {
      const diff = JSON.stringify({
        title: 'New Knowledge',
        summary: 'Agent learned something',
        content: 'Detailed content',
        category: 'Agent Contributed',
        tags: ['learning'],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockCreateKBEntry.mockResolvedValueOnce({});

      const proposal = await createProposal('agent-1', 'add_to_kb', 'KB entry', diff);

      expect(proposal.status).toBe('executed');
      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Knowledge',
          summary: 'Agent learned something',
          content: 'Detailed content',
          category: 'Agent Contributed',
          tags: ['learning'],
          sourceType: 'agent',
          contributedBy: 'agent-1',
          approved: false,
        })
      );
    });

    it('auto-executes commit_code with file artifacts', async () => {
      const diff = JSON.stringify({
        files: [
          { path: '/src/helper.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
        ],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })  // INSERT proposal
        .mockResolvedValueOnce({ rowCount: 1 }); // INSERT code artifact
      mockValidateArtifactPath.mockReturnValueOnce(undefined);

      const proposal = await createProposal('agent-1', 'commit_code', 'code commit', diff);

      expect(proposal.status).toBe('executed');
      expect(mockValidateArtifactPath).toHaveBeenCalledWith('/src/helper.ts');
      expect(mockExecute).toHaveBeenCalledTimes(2);
      const artifactInsert = mockExecute.mock.calls[1];
      expect(artifactInsert[0]).toContain('INSERT INTO code_artifacts');
    });

    it('logs the proposal creation', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent());
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await createProposal('agent-1', 'write_tool', 'desc', '{}');

      expect(logger.info).toHaveBeenCalledWith(
        'Evolution proposal created',
        expect.objectContaining({
          proposalId: 'test-uuid-1234',
          agentId: 'agent-1',
          action: 'write_tool',
          mode: 'approve-first',
        })
      );
    });
  });

  // ────────────────────────────────────────────
  //  approveProposal
  // ────────────────────────────────────────────
  describe('approveProposal', () => {
    it('approves a pending proposal and executes it', async () => {
      const proposal = makeProposal({ status: 'pending' });
      mockQueryOne.mockResolvedValueOnce(proposal);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      // executeProposal: write_tool with stored_in_db
      mockValidateToolName.mockReturnValueOnce(undefined);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE status

      const result = await approveProposal('proposal-1', 'user-1');

      expect(result.status).toBe('approved');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ['approved', 'proposal-1']
      );
    });

    it('throws if proposal not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(approveProposal('nonexistent', 'user-1'))
        .rejects.toThrow('Proposal nonexistent not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(approveProposal('proposal-1', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });

    it('throws if proposal is already approved', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal({ status: 'approved' }));
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await expect(approveProposal('proposal-1', 'user-1'))
        .rejects.toThrow('approved, cannot approve');
    });

    it('throws if proposal is already rejected', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal({ status: 'rejected' }));
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await expect(approveProposal('proposal-1', 'user-1'))
        .rejects.toThrow('rejected, cannot approve');
    });

    it('throws if proposal is already executed', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal({ status: 'executed' }));
      mockCanModifyAgent.mockResolvedValueOnce(true);

      await expect(approveProposal('proposal-1', 'user-1'))
        .rejects.toThrow('executed, cannot approve');
    });

    it('logs the approval', async () => {
      const proposal = makeProposal({ status: 'pending' });
      mockQueryOne.mockResolvedValueOnce(proposal);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockValidateToolName.mockReturnValueOnce(undefined);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await approveProposal('proposal-1', 'user-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Evolution proposal approved',
        expect.objectContaining({ proposalId: 'proposal-1', userId: 'user-1' })
      );
    });

    it('executes update_prompt action on approval', async () => {
      const proposal = makeProposal({
        status: 'pending',
        action: 'update_prompt',
        diff: 'You are a better agent now.',
      });
      mockQueryOne.mockResolvedValueOnce(proposal);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockUpdateAgent.mockResolvedValueOnce(undefined);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await approveProposal('proposal-1', 'user-1');

      expect(mockUpdateAgent).toHaveBeenCalledWith(
        'agent-1',
        { system_prompt: 'You are a better agent now.' },
        'agent-1'
      );
    });

    it('executes add_to_kb action on approval', async () => {
      const diff = JSON.stringify({
        title: 'Knowledge',
        summary: 'Learned',
        content: 'Content',
        category: 'Agent Contributed',
        tags: ['auto'],
      });
      const proposal = makeProposal({ status: 'pending', action: 'add_to_kb', diff });
      mockQueryOne.mockResolvedValueOnce(proposal);
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockCreateKBEntry.mockResolvedValueOnce({});
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await approveProposal('proposal-1', 'user-1');

      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Knowledge',
          sourceType: 'agent',
          approved: false,
        })
      );
    });
  });

  // ────────────────────────────────────────────
  //  rejectProposal
  // ────────────────────────────────────────────
  describe('rejectProposal', () => {
    it('rejects a proposal', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal());
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await rejectProposal('proposal-1', 'user-1');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ['rejected', 'proposal-1']
      );
    });

    it('throws if proposal not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      await expect(rejectProposal('nonexistent', 'user-1'))
        .rejects.toThrow('Proposal nonexistent not found');
    });

    it('throws if user lacks permission', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal());
      mockCanModifyAgent.mockResolvedValueOnce(false);

      await expect(rejectProposal('proposal-1', 'user-1'))
        .rejects.toThrow('Insufficient permissions');
    });

    it('logs the rejection', async () => {
      mockQueryOne.mockResolvedValueOnce(makeProposal());
      mockCanModifyAgent.mockResolvedValueOnce(true);
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await rejectProposal('proposal-1', 'user-1');

      expect(logger.info).toHaveBeenCalledWith(
        'Evolution proposal rejected',
        expect.objectContaining({ proposalId: 'proposal-1', userId: 'user-1' })
      );
    });
  });

  // ────────────────────────────────────────────
  //  getProposal
  // ────────────────────────────────────────────
  describe('getProposal', () => {
    it('returns a proposal by id', async () => {
      const proposal = makeProposal();
      mockQueryOne.mockResolvedValueOnce(proposal);

      const result = await getProposal('proposal-1');

      expect(result).toEqual(proposal);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('evolution_proposals'),
        ['proposal-1']
      );
    });

    it('returns null when proposal not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getProposal('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when queryOne returns null', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getProposal('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────
  //  getPendingProposals
  // ────────────────────────────────────────────
  describe('getPendingProposals', () => {
    it('returns pending proposals for a specific agent', async () => {
      const proposals = [makeProposal(), makeProposal({ id: 'proposal-2' })];
      mockQuery.mockResolvedValueOnce(proposals);

      const result = await getPendingProposals('agent-1');

      expect(result).toEqual(proposals);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('agent_id = $1'),
        ['agent-1', 'pending']
      );
    });

    it('returns all pending proposals when no agentId provided', async () => {
      const proposals = [makeProposal()];
      mockQuery.mockResolvedValueOnce(proposals);

      const result = await getPendingProposals();

      expect(result).toEqual(proposals);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = $1"),
        ['pending']
      );
    });

    it('returns empty array when no pending proposals', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getPendingProposals('agent-1');
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  //  getProposalHistory
  // ────────────────────────────────────────────
  describe('getProposalHistory', () => {
    it('returns proposal history for an agent', async () => {
      const proposals = [
        makeProposal({ status: 'approved' }),
        makeProposal({ id: 'p2', status: 'rejected' }),
        makeProposal({ id: 'p3', status: 'pending' }),
      ];
      mockQuery.mockResolvedValueOnce(proposals);

      const result = await getProposalHistory('agent-1');

      expect(result).toEqual(proposals);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 50'),
        ['agent-1']
      );
    });

    it('returns empty array for agent with no proposals', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getProposalHistory('agent-none');
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────
  //  expireOldProposals
  // ────────────────────────────────────────────
  describe('expireOldProposals', () => {
    it('expires pending proposals older than 30 minutes', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 3 });

      const count = await expireOldProposals();

      expect(count).toBe(3);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'rejected'"),
        [expect.any(String)] // cutoff timestamp
      );
    });

    it('returns 0 when no proposals need expiry', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 0 });

      const count = await expireOldProposals();

      expect(count).toBe(0);
    });

    it('logs when proposals are expired', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 5 });

      await expireOldProposals();

      expect(logger.info).toHaveBeenCalledWith(
        'Expired pending proposals',
        { count: 5 }
      );
    });

    it('does not log when no proposals are expired', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 0 });

      await expireOldProposals();

      expect(logger.info).not.toHaveBeenCalledWith(
        'Expired pending proposals',
        expect.anything()
      );
    });

    it('uses 30 minute timeout cutoff', async () => {
      const beforeCall = Date.now();
      mockExecute.mockResolvedValueOnce({ rowCount: 0 });

      await expireOldProposals();

      const [, params] = mockExecute.mock.calls[0];
      const cutoff = new Date(params[0]).getTime();
      const expectedCutoff = beforeCall - 30 * 60 * 1000;
      // Allow 1 second tolerance
      expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(1000);
    });
  });

  // ────────────────────────────────────────────
  //  Execution error handling
  // ────────────────────────────────────────────
  describe('execution error handling', () => {
    it('wraps execution errors with context', async () => {
      const diff = JSON.stringify({ name: 'bad-tool' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 }); // INSERT
      mockValidateToolName.mockImplementationOnce(() => {
        throw new Error('name invalid');
      });

      await expect(createProposal('agent-1', 'write_tool', 'desc', diff))
        .rejects.toThrow('Failed to execute write_tool proposal: name invalid');
    });

    it('logs execution errors', async () => {
      const diff = '{ invalid json }}}';
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      try {
        await createProposal('agent-1', 'write_tool', 'desc', diff);
      } catch {
        // expected to throw
      }

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to execute proposal',
        expect.objectContaining({
          action: 'write_tool',
        })
      );
    });

    it('handles create_mcp with invalid JSON diff', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await expect(createProposal('agent-1', 'create_mcp', 'desc', 'not-json'))
        .rejects.toThrow('Failed to execute create_mcp proposal');
    });

    it('handles commit_code with invalid JSON diff', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await expect(createProposal('agent-1', 'commit_code', 'desc', 'not-json'))
        .rejects.toThrow('Failed to execute commit_code proposal');
    });

    it('handles add_to_kb with invalid JSON diff', async () => {
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      await expect(createProposal('agent-1', 'add_to_kb', 'desc', 'not-json'))
        .rejects.toThrow('Failed to execute add_to_kb proposal');
    });
  });

  // ────────────────────────────────────────────
  //  commit_code edge cases
  // ────────────────────────────────────────────
  describe('commit_code execution', () => {
    it('handles multiple files in a single commit', async () => {
      const diff = JSON.stringify({
        files: [
          { path: '/src/a.ts', content: 'export const a = 1;' },
          { path: '/src/b.ts', content: 'export const b = 2;' },
          { path: '/src/c.py', content: 'c = 3' },
        ],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })  // INSERT proposal
        .mockResolvedValueOnce({ rowCount: 1 })  // file a
        .mockResolvedValueOnce({ rowCount: 1 })  // file b
        .mockResolvedValueOnce({ rowCount: 1 }); // file c
      mockValidateArtifactPath.mockReturnValue(undefined);

      const proposal = await createProposal('agent-1', 'commit_code', 'multi-file', diff);

      expect(proposal.status).toBe('executed');
      expect(mockValidateArtifactPath).toHaveBeenCalledTimes(3);
      // 1 for proposal INSERT + 3 for code artifacts
      expect(mockExecute).toHaveBeenCalledTimes(4);
    });

    it('skips files with missing path or content', async () => {
      const diff = JSON.stringify({
        files: [
          { path: '/src/a.ts', content: 'code' },
          { path: null, content: 'code' },           // no path
          { path: '/src/b.ts', content: '' },         // empty content is falsy
          { path: '/src/c.ts' },                      // no content key
        ],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })  // INSERT proposal
        .mockResolvedValueOnce({ rowCount: 1 }); // only first file
      mockValidateArtifactPath.mockReturnValue(undefined);

      await createProposal('agent-1', 'commit_code', 'partial', diff);

      // Only 1 valid file (path + content both truthy)
      expect(mockValidateArtifactPath).toHaveBeenCalledTimes(1);
    });

    it('detects language from file extension', async () => {
      const diff = JSON.stringify({
        files: [
          { path: '/src/helper.py', content: 'print("hi")' },
        ],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      mockValidateArtifactPath.mockReturnValue(undefined);

      await createProposal('agent-1', 'commit_code', 'py file', diff);

      const artifactInsertParams = mockExecute.mock.calls[1][1];
      // language param should be 'python'
      expect(artifactInsertParams).toContain('python');
    });

    it('falls back to text for unknown extensions', async () => {
      const diff = JSON.stringify({
        files: [{ path: '/src/data.xyz', content: 'data' }],
      });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });
      mockValidateArtifactPath.mockReturnValue(undefined);

      await createProposal('agent-1', 'commit_code', 'unknown ext', diff);

      const artifactInsertParams = mockExecute.mock.calls[1][1];
      expect(artifactInsertParams).toContain('text');
    });

    it('handles changes without files array gracefully', async () => {
      const diff = JSON.stringify({ message: 'no files' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });

      // Should not throw - just does nothing since there's no files array
      const proposal = await createProposal('agent-1', 'commit_code', 'empty', diff);
      expect(proposal.status).toBe('executed');
      // Only the proposal INSERT, no artifact inserts
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────
  //  create_mcp edge cases
  // ────────────────────────────────────────────
  describe('create_mcp execution', () => {
    it('auto-approves MCP config in autonomous mode', async () => {
      const diff = JSON.stringify({ name: 'test-mcp', url: 'http://localhost' });
      mockGetAgent
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }))
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await createProposal('agent-1', 'create_mcp', 'desc', diff);

      const mcpInsertParams = mockExecute.mock.calls[1][1];
      // approved param should be true for autonomous mode
      expect(mcpInsertParams[4]).toBe(true);
    });

    it('generates fallback name if config has no name', async () => {
      const diff = JSON.stringify({ url: 'http://localhost' });
      mockGetAgent
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }))
        .mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await createProposal('agent-1', 'create_mcp', 'desc', diff);

      const mcpInsertParams = mockExecute.mock.calls[1][1];
      // name should be generated from proposal id: mcp-test-uui (first 8 chars)
      expect(mcpInsertParams[2]).toMatch(/^mcp-/);
    });
  });

  // ────────────────────────────────────────────
  //  add_to_kb with missing fields
  // ────────────────────────────────────────────
  describe('add_to_kb with missing fields', () => {
    it('uses proposal description as fallback title', async () => {
      const diff = JSON.stringify({ content: 'some content' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockCreateKBEntry.mockResolvedValueOnce({});

      await createProposal('agent-1', 'add_to_kb', 'My Description', diff);

      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'My Description', // falls back to proposal.description
        })
      );
    });

    it('defaults category to Agent Contributed', async () => {
      const diff = JSON.stringify({ title: 'KB', content: 'content' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockCreateKBEntry.mockResolvedValueOnce({});

      await createProposal('agent-1', 'add_to_kb', 'desc', diff);

      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Agent Contributed' })
      );
    });

    it('defaults tags to empty array', async () => {
      const diff = JSON.stringify({ title: 'KB', content: 'content' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockCreateKBEntry.mockResolvedValueOnce({});

      await createProposal('agent-1', 'add_to_kb', 'desc', diff);

      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] })
      );
    });

    it('uses diff as content fallback when content field missing', async () => {
      const diff = JSON.stringify({ title: 'KB' });
      mockGetAgent.mockResolvedValueOnce(makeAgent({ self_evolution_mode: 'autonomous' }));
      mockExecute.mockResolvedValueOnce({ rowCount: 1 });
      mockCreateKBEntry.mockResolvedValueOnce({});

      await createProposal('agent-1', 'add_to_kb', 'desc', diff);

      expect(mockCreateKBEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          content: diff, // falls back to the raw diff string
        })
      );
    });
  });
});
