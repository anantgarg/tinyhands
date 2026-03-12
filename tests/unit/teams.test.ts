import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockGetAgent = vi.fn();
const mockEnqueueRun = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

vi.mock('../../src/modules/agents', () => ({
  getAgent: (...args: any[]) => mockGetAgent(...args),
}));

vi.mock('../../src/queue', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

vi.mock('../../src/slack', () => ({
  postMessage: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createTeamRun,
  getTeamRun,
  spawnSubAgent,
  completeSubAgent,
  getTeamResults,
  getTeamCost,
  formatTeamProgress,
} from '../../src/modules/teams';

describe('Teams Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createTeamRun ──

  describe('createTeamRun', () => {
    it('should create a team run with default concurrency and depth', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        name: 'lead-agent',
        permission_level: 'full',
      });

      const teamRun = await createTeamRun('agent-1', 'run-1');

      expect(teamRun).toBeDefined();
      expect(teamRun.id).toBeDefined();
      expect(teamRun.lead_agent_id).toBe('agent-1');
      expect(teamRun.lead_run_id).toBe('run-1');
      expect(teamRun.max_concurrent).toBe(3);
      expect(teamRun.max_depth).toBe(2);
      expect(teamRun.sub_agents).toEqual([]);
      expect(teamRun.created_at).toBeDefined();
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO team_runs'),
        expect.arrayContaining([teamRun.id, 'agent-1', 'run-1', 3, 2]),
      );
    });

    it('should create a team run with custom concurrency and depth', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        permission_level: 'full',
      });

      const teamRun = await createTeamRun('agent-1', 'run-1', 5, 4);

      expect(teamRun.max_concurrent).toBe(5);
      expect(teamRun.max_depth).toBe(4);
    });

    it('should throw if agent is not found', async () => {
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(createTeamRun('missing-agent', 'run-1'))
        .rejects.toThrow('Agent missing-agent not found');
    });

    it('should throw if agent does not have full permission level', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        permission_level: 'standard',
      });

      await expect(createTeamRun('agent-1', 'run-1'))
        .rejects.toThrow('Agent teams require full permission level');
    });

    it('should throw for read_only permission level', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        permission_level: 'read_only',
      });

      await expect(createTeamRun('agent-1', 'run-1'))
        .rejects.toThrow('Agent teams require full permission level');
    });

    it('should use default max_concurrent when 0 is passed', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        permission_level: 'full',
      });

      // 0 is falsy, so || will use default
      const teamRun = await createTeamRun('agent-1', 'run-1', 0);
      expect(teamRun.max_concurrent).toBe(3);
    });

    it('should use default max_depth when 0 is passed', async () => {
      mockGetAgent.mockResolvedValueOnce({
        id: 'agent-1',
        permission_level: 'full',
      });

      const teamRun = await createTeamRun('agent-1', 'run-1', undefined, 0);
      expect(teamRun.max_depth).toBe(2);
    });
  });

  // ── getTeamRun ──

  describe('getTeamRun', () => {
    it('should return team run with sub-agent runs', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'agent-1',
        lead_run_id: 'run-1',
        max_concurrent: 3,
        max_depth: 2,
        created_at: '2026-01-01T00:00:00Z',
      });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', team_run_id: 'team-1', agent_id: 'agent-2', status: 'completed', task: 'task1', result: 'done' },
        { id: 'sub-2', team_run_id: 'team-1', agent_id: 'agent-3', status: 'running', task: 'task2', result: null },
      ]);

      const teamRun = await getTeamRun('team-1');

      expect(teamRun).toBeDefined();
      expect(teamRun!.id).toBe('team-1');
      expect(teamRun!.sub_agents).toHaveLength(2);
      expect(teamRun!.sub_agents[0].id).toBe('sub-1');
      expect(teamRun!.sub_agents[1].status).toBe('running');
    });

    it('should return null if team run not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const teamRun = await getTeamRun('nonexistent');
      expect(teamRun).toBeNull();
    });

    it('should return team run with empty sub-agents when none exist', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'agent-1',
        lead_run_id: 'run-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);

      const teamRun = await getTeamRun('team-1');
      expect(teamRun!.sub_agents).toEqual([]);
    });
  });

  // ── spawnSubAgent ──

  describe('spawnSubAgent', () => {
    function setupSpawnMocks(overrides: {
      teamRun?: any;
      subAgents?: any[];
      activeCount?: string;
      subAgent?: any;
      leadAgent?: any;
    } = {}) {
      // getTeamRun: queryOne for team_runs, then query for sub_agent_runs
      mockQueryOne.mockResolvedValueOnce(overrides.teamRun ?? {
        id: 'team-1',
        lead_agent_id: 'lead-1',
        lead_run_id: 'run-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce(overrides.subAgents ?? []);
      // active count query
      mockQueryOne.mockResolvedValueOnce({ count: overrides.activeCount ?? '0' });
      // getAgent for sub-agent
      mockGetAgent.mockResolvedValueOnce(overrides.subAgent ?? {
        id: 'agent-2',
        name: 'sub-agent',
        permission_level: 'standard',
      });
      // getAgent for lead agent
      mockGetAgent.mockResolvedValueOnce(overrides.leadAgent ?? {
        id: 'lead-1',
        name: 'lead-agent',
        permission_level: 'full',
      });
    }

    it('should spawn a sub-agent at default depth 1', async () => {
      setupSpawnMocks();

      const subRun = await spawnSubAgent('team-1', 'agent-2', 'Analyze data');

      expect(subRun).toBeDefined();
      expect(subRun.team_run_id).toBe('team-1');
      expect(subRun.agent_id).toBe('agent-2');
      expect(subRun.depth).toBe(1);
      expect(subRun.status).toBe('queued');
      expect(subRun.task).toBe('Analyze data');
      expect(subRun.result).toBeNull();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sub_agent_runs'),
        expect.any(Array),
      );
      expect(mockEnqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-2',
          input: 'Analyze data',
          channelId: '',
          threadTs: '',
          userId: null,
        }),
        'normal',
      );
    });

    it('should spawn a sub-agent at a custom depth', async () => {
      setupSpawnMocks();

      const subRun = await spawnSubAgent('team-1', 'agent-2', 'task', 2);
      expect(subRun.depth).toBe(2);
    });

    it('should throw if team run not found', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // team run not found

      await expect(spawnSubAgent('nonexistent', 'agent-2', 'task'))
        .rejects.toThrow('Team run nonexistent not found');
    });

    it('should throw if depth exceeds max_depth', async () => {
      // getTeamRun
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);

      await expect(spawnSubAgent('team-1', 'agent-2', 'task', 3))
        .rejects.toThrow('Max spawn depth (2) exceeded. Cannot spawn at depth 3.');
    });

    it('should throw if depth equals max_depth + 1', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 5,
        max_depth: 1,
      });
      mockQuery.mockResolvedValueOnce([]);

      await expect(spawnSubAgent('team-1', 'agent-2', 'task', 2))
        .rejects.toThrow('Max spawn depth (1) exceeded');
    });

    it('should allow spawn at exact max_depth', async () => {
      // depth === max_depth is allowed (depth > max_depth triggers error)
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);
      // active count
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      // getAgent for sub-agent
      mockGetAgent.mockResolvedValueOnce({ id: 'agent-2', permission_level: 'standard' });
      // getAgent for lead
      mockGetAgent.mockResolvedValueOnce({ id: 'lead-1', permission_level: 'full' });

      const subRun = await spawnSubAgent('team-1', 'agent-2', 'task', 2);
      expect(subRun.depth).toBe(2);
    });

    it('should throw if concurrent limit is reached', async () => {
      // getTeamRun
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 2,
        max_depth: 3,
      });
      mockQuery.mockResolvedValueOnce([]);
      // active count = 2, which matches max_concurrent
      mockQueryOne.mockResolvedValueOnce({ count: '2' });

      await expect(spawnSubAgent('team-1', 'agent-2', 'task'))
        .rejects.toThrow('Max concurrent sub-agents (2) reached');
    });

    it('should allow spawn when active count is below concurrent limit', async () => {
      // getTeamRun
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);
      // active count = 2, below max of 3
      mockQueryOne.mockResolvedValueOnce({ count: '2' });
      mockGetAgent.mockResolvedValueOnce({ id: 'agent-2', permission_level: 'standard' });
      mockGetAgent.mockResolvedValueOnce({ id: 'lead-1', permission_level: 'full' });

      const subRun = await spawnSubAgent('team-1', 'agent-2', 'task');
      expect(subRun).toBeDefined();
    });

    it('should throw if sub-agent not found', async () => {
      // getTeamRun
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      // getAgent returns null for the sub-agent
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(spawnSubAgent('team-1', 'missing-agent', 'task'))
        .rejects.toThrow('Agent missing-agent not found');
    });

    it('should throw if lead agent not found', async () => {
      // getTeamRun
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        max_concurrent: 3,
        max_depth: 2,
      });
      mockQuery.mockResolvedValueOnce([]);
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      mockGetAgent.mockResolvedValueOnce({ id: 'agent-2', permission_level: 'standard' });
      // lead agent not found
      mockGetAgent.mockResolvedValueOnce(null);

      await expect(spawnSubAgent('team-1', 'agent-2', 'task'))
        .rejects.toThrow('Lead agent not found');
    });

    it('should enqueue the sub-agent job with correct data', async () => {
      setupSpawnMocks();

      await spawnSubAgent('team-1', 'agent-2', 'Do analysis');

      expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
      const jobData = mockEnqueueRun.mock.calls[0][0];
      expect(jobData.agentId).toBe('agent-2');
      expect(jobData.input).toBe('Do analysis');
      expect(jobData.channelId).toBe('');
      expect(jobData.threadTs).toBe('');
      expect(jobData.userId).toBeNull();
      expect(jobData.traceId).toBeDefined();
    });
  });

  // ── completeSubAgent ──

  describe('completeSubAgent', () => {
    it('should update status and result', async () => {
      // execute for UPDATE
      mockExecute.mockResolvedValueOnce(undefined);
      // queryOne for fetching the sub-run after update
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        team_run_id: 'team-1',
        agent_id: 'agent-2',
        status: 'completed',
        result: 'Analysis complete',
      });
      // checkTeamCompletion: count of pending
      mockQueryOne.mockResolvedValueOnce({ count: '1' });

      await completeSubAgent('sub-1', 'completed', 'Analysis complete');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sub_agent_runs SET status'),
        ['completed', 'Analysis complete', 'sub-1'],
      );
    });

    it('should handle failed status', async () => {
      mockExecute.mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        team_run_id: 'team-1',
        status: 'failed',
      });
      // checkTeamCompletion: still pending
      mockQueryOne.mockResolvedValueOnce({ count: '1' });

      await completeSubAgent('sub-1', 'failed', 'Error occurred');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sub_agent_runs'),
        ['failed', 'Error occurred', 'sub-1'],
      );
    });

    it('should silently return if sub-run not found after update', async () => {
      mockExecute.mockResolvedValueOnce(undefined);
      mockQueryOne.mockResolvedValueOnce(null); // sub-run not found

      // Should not throw
      await completeSubAgent('nonexistent', 'completed', 'result');
    });

    it('should trigger team completion check when all sub-agents done', async () => {
      mockExecute.mockResolvedValueOnce(undefined);
      // queryOne for sub-run lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'sub-1',
        team_run_id: 'team-1',
      });
      // checkTeamCompletion: count of pending = 0 (all done)
      mockQueryOne.mockResolvedValueOnce({ count: '0' });
      // getTeamRun inside checkTeamCompletion
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
        lead_run_id: 'run-1',
      });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'completed', agent_id: 'agent-2', result: 'done' },
      ]);
      // lead run lookup
      mockQueryOne.mockResolvedValueOnce({
        id: 'run-1',
        channel_id: 'C123',
        thread_ts: '1234.5678',
      });
      // getTeamResults query
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'completed', agent_id: 'agent-2', result: 'done' },
      ]);
      // getTeamCost query
      mockQueryOne.mockResolvedValueOnce({ total_cost: '0.0123' });

      await completeSubAgent('sub-1', 'completed', 'done');

      // Should have attempted to post message
      const { postMessage } = await import('../../src/slack');
      expect(postMessage).toHaveBeenCalled();
    });
  });

  // ── getTeamResults ──

  describe('getTeamResults', () => {
    it('should separate completed and failed sub-agent runs', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'completed', task: 'task1', result: 'done' },
        { id: 'sub-2', status: 'failed', task: 'task2', result: 'error' },
        { id: 'sub-3', status: 'completed', task: 'task3', result: 'done2' },
      ]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toHaveLength(2);
      expect(results.failed).toHaveLength(1);
      expect(results.allDone).toBe(true);
    });

    it('should report allDone as false when some are still running', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'completed', task: 'task1' },
        { id: 'sub-2', status: 'running', task: 'task2' },
      ]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toHaveLength(1);
      expect(results.failed).toHaveLength(0);
      expect(results.allDone).toBe(false);
    });

    it('should report allDone as false when some are queued', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'queued', task: 'task1' },
      ]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toHaveLength(0);
      expect(results.failed).toHaveLength(0);
      expect(results.allDone).toBe(false);
    });

    it('should return empty arrays and allDone true when no sub-agents', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toEqual([]);
      expect(results.failed).toEqual([]);
      expect(results.allDone).toBe(true);
    });

    it('should handle all failed runs', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'failed', task: 'task1', result: 'err1' },
        { id: 'sub-2', status: 'failed', task: 'task2', result: 'err2' },
      ]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toHaveLength(0);
      expect(results.failed).toHaveLength(2);
      expect(results.allDone).toBe(true);
    });

    it('should handle timeout status as not completed and not failed', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', status: 'timeout', task: 'task1' },
      ]);

      const results = await getTeamResults('team-1');

      expect(results.completed).toHaveLength(0);
      expect(results.failed).toHaveLength(0);
      // timeout is neither 'completed' nor 'failed', so allDone is false
      expect(results.allDone).toBe(false);
    });
  });

  // ── getTeamCost ──

  describe('getTeamCost', () => {
    it('should return total cost from sub-agent runs', async () => {
      mockQueryOne.mockResolvedValueOnce({ total_cost: '1.2345' });

      const cost = await getTeamCost('team-1');

      expect(cost).toBe(1.2345);
      expect(mockQueryOne).toHaveBeenCalledWith(
        expect.stringContaining('SUM'),
        ['team-1'],
      );
    });

    it('should return 0 when no cost data', async () => {
      mockQueryOne.mockResolvedValueOnce({ total_cost: '0' });

      const cost = await getTeamCost('team-1');
      expect(cost).toBe(0);
    });

    it('should return 0 when result is null', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const cost = await getTeamCost('team-1');
      expect(cost).toBe(0);
    });

    it('should return 0 when total_cost is undefined', async () => {
      mockQueryOne.mockResolvedValueOnce({});

      const cost = await getTeamCost('team-1');
      expect(cost).toBe(0);
    });

    it('should handle fractional costs', async () => {
      mockQueryOne.mockResolvedValueOnce({ total_cost: '0.000042' });

      const cost = await getTeamCost('team-1');
      expect(cost).toBeCloseTo(0.000042);
    });
  });

  // ── formatTeamProgress ──

  describe('formatTeamProgress', () => {
    it('should return "Team run not found" if team run does not exist', async () => {
      mockQueryOne.mockResolvedValueOnce(null); // getTeamRun returns null

      const result = await formatTeamProgress('nonexistent');
      expect(result).toBe('Team run not found');
    });

    it('should return "No sub-agents spawned yet" when no sub-agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
      });
      mockQuery.mockResolvedValueOnce([]);

      const result = await formatTeamProgress('team-1');
      expect(result).toBe('No sub-agents spawned yet');
    });

    it('should format progress with status emojis for completed sub-agents', async () => {
      mockQueryOne.mockResolvedValueOnce({
        id: 'team-1',
        lead_agent_id: 'lead-1',
      });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh-1234', depth: 1, status: 'completed', task: 'Analyze data', result: 'Data analyzed' },
      ]);

      const result = await formatTeamProgress('team-1');

      expect(result).toContain('*Team Progress:*');
      expect(result).toContain(':white_check_mark:');
      expect(result).toContain('abcdefgh');
      expect(result).toContain('depth 1');
      expect(result).toContain('Analyze data');
      expect(result).toContain('_Result: Data analyzed_');
    });

    it('should use :x: emoji for failed sub-agents', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'failed', task: 'task1', result: 'error' },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).toContain(':x:');
    });

    it('should use :hourglass: emoji for running sub-agents', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'running', task: 'task1', result: null },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).toContain(':hourglass:');
    });

    it('should use :clock1: emoji for queued sub-agents', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'queued', task: 'task1', result: null },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).toContain(':clock1:');
    });

    it('should truncate long task strings to 60 characters', async () => {
      const longTask = 'A'.repeat(100);
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'running', task: longTask, result: null },
      ]);

      const result = await formatTeamProgress('team-1');
      // The task should be sliced to 60 chars
      expect(result).toContain('A'.repeat(60));
      expect(result).not.toContain('A'.repeat(61));
    });

    it('should truncate long result strings to 100 characters', async () => {
      const longResult = 'B'.repeat(200);
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'completed', task: 'task', result: longResult },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).toContain('B'.repeat(100));
      expect(result).not.toContain('B'.repeat(101));
    });

    it('should not show result line when result is null', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'abcdefgh', depth: 1, status: 'queued', task: 'task1', result: null },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).not.toContain('_Result:');
    });

    it('should format multiple sub-agents with different statuses', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: 'aaaaaaaa', depth: 1, status: 'completed', task: 'task1', result: 'done' },
        { id: 'sub-2', agent_id: 'bbbbbbbb', depth: 2, status: 'running', task: 'task2', result: null },
        { id: 'sub-3', agent_id: 'cccccccc', depth: 1, status: 'failed', task: 'task3', result: 'err' },
        { id: 'sub-4', agent_id: 'dddddddd', depth: 1, status: 'queued', task: 'task4', result: null },
      ]);

      const result = await formatTeamProgress('team-1');

      expect(result).toContain(':white_check_mark:');
      expect(result).toContain(':hourglass:');
      expect(result).toContain(':x:');
      expect(result).toContain(':clock1:');
      expect(result).toContain('depth 2');
    });

    it('should slice agent_id to first 8 characters', async () => {
      mockQueryOne.mockResolvedValueOnce({ id: 'team-1', lead_agent_id: 'lead-1' });
      mockQuery.mockResolvedValueOnce([
        { id: 'sub-1', agent_id: '12345678-abcd-efgh', depth: 1, status: 'completed', task: 'task', result: null },
      ]);

      const result = await formatTeamProgress('team-1');
      expect(result).toContain('*12345678*');
      expect(result).not.toContain('12345678-');
    });
  });
});
