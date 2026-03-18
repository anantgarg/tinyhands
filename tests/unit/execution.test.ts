import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
}));

const mockCheckRateLimit = vi.fn().mockResolvedValue({ allowed: true });
const mockCheckRequestRate = vi.fn().mockResolvedValue(true);
const mockRecordTokenUsage = vi.fn().mockResolvedValue(undefined);
const mockGetRedisConnection = vi.fn();

vi.mock('../../src/queue', () => ({
  getRedisConnection: (...args: any[]) => mockGetRedisConnection(...args),
  recordTokenUsage: (...args: any[]) => mockRecordTokenUsage(...args),
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  checkRequestRate: (...args: any[]) => mockCheckRequestRate(...args),
}));

const mockCreateAgentContainer = vi.fn();
const mockStartContainer = vi.fn();
const mockWaitForContainer = vi.fn();
const mockRemoveContainer = vi.fn().mockResolvedValue(undefined);
const mockFollowContainerOutput = vi.fn();

vi.mock('../../src/docker', () => ({
  createAgentContainer: (...args: any[]) => mockCreateAgentContainer(...args),
  startContainer: (...args: any[]) => mockStartContainer(...args),
  waitForContainer: (...args: any[]) => mockWaitForContainer(...args),
  removeContainer: (...args: any[]) => mockRemoveContainer(...args),
  followContainerOutput: (...args: any[]) => mockFollowContainerOutput(...args),
}));

const mockGetAgent = vi.fn();
vi.mock('../../src/modules/agents', () => ({ getAgent: (...args: any[]) => mockGetAgent(...args) }));

const mockRetrieveContext = vi.fn().mockResolvedValue([]);
vi.mock('../../src/modules/sources', () => ({ retrieveContext: (...args: any[]) => mockRetrieveContext(...args) }));

const mockRetrieveMemories = vi.fn().mockResolvedValue([]);
const mockStoreMemories = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/modules/sources/memory', () => ({
  retrieveMemories: (...args: any[]) => mockRetrieveMemories(...args),
  storeMemories: (...args: any[]) => mockStoreMemories(...args),
}));

vi.mock('../../src/modules/permissions', () => ({
  isActionAllowed: vi.fn(),
  validateIntegrationAccess: vi.fn(),
}));

const mockGetAgentSkills = vi.fn().mockResolvedValue([]);
vi.mock('../../src/modules/skills', () => ({ getAgentSkills: (...args: any[]) => mockGetAgentSkills(...args) }));

const mockListCustomTools = vi.fn().mockResolvedValue([]);
vi.mock('../../src/modules/tools', () => ({ listCustomTools: (...args: any[]) => mockListCustomTools(...args) }));

const mockGetToolExecutionScript = vi.fn();
const mockGetMcpConfigs = vi.fn().mockResolvedValue([]);
const mockGetCodeArtifacts = vi.fn().mockResolvedValue([]);
vi.mock('../../src/modules/self-authoring', () => ({
  getToolExecutionScript: (...args: any[]) => mockGetToolExecutionScript(...args),
  getMcpConfigs: (...args: any[]) => mockGetMcpConfigs(...args),
  getCodeArtifacts: (...args: any[]) => mockGetCodeArtifacts(...args),
  recordToolRun: vi.fn(),
}));

// Mock access-control for permission context
const mockGetAgentRole = vi.fn().mockResolvedValue('member');
vi.mock('../../src/modules/access-control', () => ({
  getAgentRole: (...args: any[]) => mockGetAgentRole(...args),
}));

// Mock audit module
const mockLogAuditEvent = vi.fn();
vi.mock('../../src/modules/audit', () => ({
  logAuditEvent: (...args: any[]) => mockLogAuditEvent(...args),
}));

// Mock Anthropic SDK for memory extraction
const mockAnthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: (...args: any[]) => mockAnthropicCreate(...args) };
  },
}));

// Mock BullMQ Worker
const mockWorkerOn = vi.fn();
const mockWorkerPause = vi.fn().mockResolvedValue(undefined);
const mockWorkerResume = vi.fn().mockResolvedValue(undefined);
let capturedWorkerProcessor: any = null;
vi.mock('bullmq', () => ({
  Worker: class {
    on: any;
    pause: any;
    resume: any;
    constructor(_queue: string, processor: any, _opts: any) {
      capturedWorkerProcessor = processor;
      this.on = mockWorkerOn;
      this.pause = mockWorkerPause;
      this.resume = mockWorkerResume;
    }
  },
}));

const mockBufferEvent = vi.fn();
const mockSetStatusMessageTs = vi.fn();
const mockCleanupStatusMessage = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/slack/buffer', () => ({
  bufferEvent: (...args: any[]) => mockBufferEvent(...args),
  setStatusMessageTs: (...args: any[]) => mockSetStatusMessageTs(...args),
  cleanupStatusMessage: (...args: any[]) => mockCleanupStatusMessage(...args),
}));

vi.mock('../../src/config', () => ({
  config: {
    docker: {
      baseImage: 'test',
      defaultCpu: 1,
      defaultMemory: 2048,
      defaultJobTimeoutMs: 60000,
      maxConcurrentWorkers: 3,
    },
    anthropic: { apiKey: 'test' },
  },
}));

const mockEstimateCost = vi.fn().mockReturnValue(0.01);
const mockGetModelId = vi.fn().mockReturnValue('claude-sonnet-4-20250514');
vi.mock('../../src/utils/costs', () => ({
  estimateCost: (...args: any[]) => mockEstimateCost(...args),
  getModelId: (...args: any[]) => mockGetModelId(...args),
}));

const mockLogRunEvent = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerDebug = vi.fn();
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: (...args: any[]) => mockLoggerInfo(...args),
    warn: (...args: any[]) => mockLoggerWarn(...args),
    error: (...args: any[]) => mockLoggerError(...args),
    debug: (...args: any[]) => mockLoggerDebug(...args),
  },
  logRunEvent: (...args: any[]) => mockLogRunEvent(...args),
}));

import {
  createRunRecord,
  updateRunRecord,
  getRunRecord,
  getRecentRuns,
  getRunsByAgent,
  executeAgentRun,
  createWorker,
} from '../../src/modules/execution';

import type { JobData, RunRecord } from '../../src/types';
import type { Job } from 'bullmq';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Helpers ──

function makeJobData(overrides: Partial<JobData> = {}): JobData {
  return {
    workspaceId: TEST_WORKSPACE_ID,
    agentId: 'agent-1',
    channelId: 'C123',
    threadTs: '1700000000.000000',
    input: 'Hello, run a task',
    userId: 'U001',
    traceId: 'trace-abc',
    ...overrides,
  };
}

function makeFakeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1',
    agent_id: 'agent-1',
    channel_id: 'C123',
    thread_ts: '1700000000.000000',
    input: 'Hello',
    output: 'Done',
    status: 'completed',
    input_tokens: 100,
    output_tokens: 50,
    estimated_cost_usd: 0.01,
    duration_ms: 1200,
    queue_wait_ms: 300,
    context_tokens_injected: 20,
    tool_calls_count: 2,
    trace_id: 'trace-abc',
    job_id: 'job-1',
    model: 'sonnet',
    slack_user_id: 'U001',
    created_at: '2025-01-01T00:00:00.000Z',
    completed_at: '2025-01-01T00:00:01.200Z',
    ...overrides,
  };
}

function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    system_prompt: 'You are a test agent.',
    model: 'sonnet' as const,
    max_turns: 5,
    tools: [],
    memory_enabled: false,
    streaming_detail: false,
    avatar_emoji: ':robot:',
    self_evolution_mode: 'approve-first',
    ...overrides,
  };
}

function makeFakeJob(data: JobData, id: string = 'job-1'): Job<JobData> {
  return {
    id,
    data,
    name: 'tinyhands-runs',
  } as unknown as Job<JobData>;
}

// ── Tests ──

describe('Execution Module – Run Record CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────
  // createRunRecord
  // ────────────────────────────────────────────

  describe('createRunRecord', () => {
    it('should create a RunRecord with correct defaults', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const data = makeJobData();
      const record = await createRunRecord(TEST_WORKSPACE_ID, data, 'job-42');

      expect(record.id).toBeDefined();
      expect(record.id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4
      expect(record.agent_id).toBe('agent-1');
      expect(record.channel_id).toBe('C123');
      expect(record.thread_ts).toBe('1700000000.000000');
      expect(record.input).toBe('Hello, run a task');
      expect(record.output).toBe('');
      expect(record.status).toBe('queued');
      expect(record.input_tokens).toBe(0);
      expect(record.output_tokens).toBe(0);
      expect(record.estimated_cost_usd).toBe(0);
      expect(record.duration_ms).toBe(0);
      expect(record.queue_wait_ms).toBe(0);
      expect(record.context_tokens_injected).toBe(0);
      expect(record.tool_calls_count).toBe(0);
      expect(record.trace_id).toBe('trace-abc');
      expect(record.job_id).toBe('job-42');
      expect(record.model).toBe('sonnet');
      expect(record.slack_user_id).toBe('U001');
      expect(record.created_at).toBeDefined();
      expect(record.completed_at).toBeNull();
    });

    it('should call execute with INSERT statement and all 20 params', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const data = makeJobData();
      await createRunRecord(TEST_WORKSPACE_ID, data, 'job-99');

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('INSERT INTO run_history');
      expect(params).toHaveLength(21);
    });

    it('should use modelOverride when provided', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const data = makeJobData({ modelOverride: 'opus' });
      const record = await createRunRecord(TEST_WORKSPACE_ID, data, 'job-1');

      expect(record.model).toBe('opus');
    });

    it('should default model to "sonnet" when no modelOverride', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const data = makeJobData({ modelOverride: undefined });
      const record = await createRunRecord(TEST_WORKSPACE_ID, data, 'job-1');

      expect(record.model).toBe('sonnet');
    });

    it('should handle null userId', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const data = makeJobData({ userId: null });
      const record = await createRunRecord(TEST_WORKSPACE_ID, data, 'job-1');

      expect(record.slack_user_id).toBeNull();
    });

    it('should propagate DB errors', async () => {
      mockExecute.mockRejectedValueOnce(new Error('DB connection lost'));

      const data = makeJobData();
      await expect(createRunRecord(data, 'job-1')).rejects.toThrow('DB connection lost');
    });

    it('should generate unique IDs for each call', async () => {
      mockExecute.mockResolvedValue(undefined);

      const data = makeJobData();
      const r1 = await createRunRecord(TEST_WORKSPACE_ID, data, 'job-1');
      const r2 = await createRunRecord(data, 'job-2');

      expect(r1.id).not.toBe(r2.id);
    });

    it('should set created_at to a recent ISO timestamp', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      const before = Date.now();
      const record = await createRunRecord(TEST_WORKSPACE_ID, makeJobData(), 'job-1');
      const after = Date.now();

      const created = new Date(record.created_at).getTime();
      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(after);
    });
  });

  // ────────────────────────────────────────────
  // updateRunRecord
  // ────────────────────────────────────────────

  describe('updateRunRecord', () => {
    it('should build a parameterised UPDATE for allowed columns', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      await updateRunRecord(TEST_WORKSPACE_ID, 'run-1', { status: 'completed', output: 'All done' });

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('UPDATE run_history SET');
      expect(sql).toContain('WHERE workspace_id =');
      expect(params).toHaveLength(4);
      expect(params).toContain('completed');
      expect(params).toContain('All done');
      expect(params).toContain(TEST_WORKSPACE_ID);
      expect(params).toContain('run-1');
    });

    it('should not call execute when updates object is empty', async () => {
      await updateRunRecord(TEST_WORKSPACE_ID, 'run-1', {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw for disallowed columns', async () => {
      await expect(
        updateRunRecord(TEST_WORKSPACE_ID, 'run-1', { id: 'new-id' } as any),
      ).rejects.toThrow('Invalid column for run record update: id');
    });

    it('should throw for agent_id (not in allowed set)', async () => {
      await expect(
        updateRunRecord(TEST_WORKSPACE_ID, 'run-1', { agent_id: 'other' } as any),
      ).rejects.toThrow('Invalid column for run record update: agent_id');
    });

    it('should accept all individually allowed columns', async () => {
      mockExecute.mockResolvedValue(undefined);

      const allowedUpdates: Partial<RunRecord> = {
        output: 'text',
        status: 'failed',
        input_tokens: 100,
        output_tokens: 50,
        estimated_cost_usd: 0.02,
        duration_ms: 5000,
        queue_wait_ms: 200,
        context_tokens_injected: 30,
        tool_calls_count: 3,
        model: 'haiku',
        completed_at: '2025-06-01T00:00:00Z',
      };

      await updateRunRecord(TEST_WORKSPACE_ID, 'run-1', allowedUpdates);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      const [sql, params] = mockExecute.mock.calls[0];
      expect(params).toHaveLength(13);
      expect(sql).toContain('output =');
      expect(sql).toContain('status =');
      expect(sql).toContain('completed_at =');
    });

    it('should update a single field correctly', async () => {
      mockExecute.mockResolvedValueOnce(undefined);

      await updateRunRecord(TEST_WORKSPACE_ID, 'run-1', { duration_ms: 9999 });

      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain('duration_ms = $1');
      expect(sql).toContain('WHERE workspace_id = $2 AND id = $3');
      expect(params).toEqual([9999, TEST_WORKSPACE_ID, 'run-1']);
    });

    it('should propagate DB errors', async () => {
      mockExecute.mockRejectedValueOnce(new Error('deadlock detected'));

      await expect(
        updateRunRecord(TEST_WORKSPACE_ID, 'run-1', { status: 'failed' }),
      ).rejects.toThrow('deadlock detected');
    });
  });

  // ────────────────────────────────────────────
  // getRunRecord
  // ────────────────────────────────────────────

  describe('getRunRecord', () => {
    it('should return a RunRecord when found', async () => {
      const fakeRow = makeFakeRunRecord();
      mockQueryOne.mockResolvedValueOnce(fakeRow);

      const result = await getRunRecord(TEST_WORKSPACE_ID, 'run-1');

      expect(mockQueryOne).toHaveBeenCalledWith(
        'SELECT * FROM run_history WHERE workspace_id = $1 AND id = $2',
        [TEST_WORKSPACE_ID, 'run-1'],
      );
      expect(result).toEqual(fakeRow);
    });

    it('should return null when not found', async () => {
      mockQueryOne.mockResolvedValueOnce(undefined);

      const result = await getRunRecord(TEST_WORKSPACE_ID, 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null explicitly (not undefined)', async () => {
      mockQueryOne.mockResolvedValueOnce(null);

      const result = await getRunRecord(TEST_WORKSPACE_ID, 'run-1');

      expect(result).toBeNull();
      expect(result).not.toBeUndefined();
    });

    it('should propagate DB errors', async () => {
      mockQueryOne.mockRejectedValueOnce(new Error('connection timeout'));

      await expect(getRunRecord('run-1')).rejects.toThrow('connection timeout');
    });
  });

  // ────────────────────────────────────────────
  // getRecentRuns
  // ────────────────────────────────────────────

  describe('getRecentRuns', () => {
    it('should query with default limit of 20', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getRecentRuns(TEST_WORKSPACE_ID);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM run_history WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
        [TEST_WORKSPACE_ID, 20],
      );
    });

    it('should respect custom limit', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getRecentRuns(TEST_WORKSPACE_ID, 5);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM run_history WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
        [TEST_WORKSPACE_ID, 5],
      );
    });

    it('should return an array of RunRecords', async () => {
      const rows = [
        makeFakeRunRecord({ id: 'run-1' }),
        makeFakeRunRecord({ id: 'run-2' }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await getRecentRuns(TEST_WORKSPACE_ID, 10);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('run-1');
      expect(result[1].id).toBe('run-2');
    });

    it('should return empty array when no runs', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getRecentRuns(TEST_WORKSPACE_ID);

      expect(result).toEqual([]);
    });

    it('should propagate DB errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('table does not exist'));

      await expect(getRecentRuns()).rejects.toThrow('table does not exist');
    });
  });

  // ────────────────────────────────────────────
  // getRunsByAgent
  // ────────────────────────────────────────────

  describe('getRunsByAgent', () => {
    it('should query with agent_id and default limit of 20', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getRunsByAgent(TEST_WORKSPACE_ID, 'agent-1');

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM run_history WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3',
        [TEST_WORKSPACE_ID, 'agent-1', 20],
      );
    });

    it('should respect custom limit', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await getRunsByAgent(TEST_WORKSPACE_ID, 'agent-1', 3);

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM run_history WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3',
        [TEST_WORKSPACE_ID, 'agent-1', 3],
      );
    });

    it('should return matching records', async () => {
      const rows = [
        makeFakeRunRecord({ id: 'r1', agent_id: 'agent-1' }),
        makeFakeRunRecord({ id: 'r2', agent_id: 'agent-1' }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await getRunsByAgent(TEST_WORKSPACE_ID, 'agent-1');

      expect(result).toHaveLength(2);
      expect(result.every(r => r.agent_id === 'agent-1')).toBe(true);
    });

    it('should return empty array when agent has no runs', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getRunsByAgent(TEST_WORKSPACE_ID, 'agent-no-runs');

      expect(result).toEqual([]);
    });

    it('should propagate DB errors', async () => {
      mockQuery.mockRejectedValueOnce(new Error('permission denied'));

      await expect(getRunsByAgent('agent-1')).rejects.toThrow('permission denied');
    });
  });
});

// ══════════════════════════════════════════════════
//  executeAgentRun
// ══════════════════════════════════════════════════

describe('Execution Module – executeAgentRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: agent exists, rate limits pass, container succeeds
    mockGetAgent.mockResolvedValue(makeAgent());
    mockExecute.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockCheckRequestRate.mockResolvedValue(true);
    mockRetrieveContext.mockResolvedValue([]);
    mockRemoveContainer.mockResolvedValue(undefined);
    mockGetAgentSkills.mockResolvedValue([]);
    mockListCustomTools.mockResolvedValue([]);
    mockGetMcpConfigs.mockResolvedValue([]);
    mockGetCodeArtifacts.mockResolvedValue([]);
  });

  it('should throw if agent is not found', async () => {
    mockGetAgent.mockResolvedValue(null);
    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('Agent agent-1 not found');
  });

  it('should throw if rate limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, usage: 90 });
    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('Rate limit exceeded');
  });

  it('should throw if RPM limit is exceeded', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockCheckRequestRate.mockResolvedValue(false);
    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('RPM limit exceeded');
  });

  it('should create a run record and update status to running', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Hello!","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should have called execute at least for INSERT (createRunRecord) and UPDATEs
    expect(mockExecute).toHaveBeenCalled();
    const insertCall = mockExecute.mock.calls.find((c: any[]) => c[0].includes('INSERT INTO run_history'));
    expect(insertCall).toBeDefined();

    // Should have updated status to running
    const runningUpdate = mockExecute.mock.calls.find(
      (c: any[]) => c[0].includes('UPDATE run_history') && c[1]?.includes('running')
    );
    expect(runningUpdate).toBeDefined();
  });

  it('should parse TINYHANDS_OUTPUT and return output', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result text","input_tokens":100,"output_tokens":50,"tool_calls_count":2,"cost_usd":0.005}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toBe('Result text');
  });

  it('should return "Task completed successfully" when output is empty on exit 0', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toBe('Task completed successfully');
    // Should silently clean up instead of posting to Slack
    expect(mockCleanupStatusMessage).toHaveBeenCalled();
    expect(mockBufferEvent).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'done', expect.anything(),
      expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    );
  });

  it('should report failure when exit code is non-zero', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 1,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Error occurred","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toContain('Task failed with exit code 1');
    expect(result).toContain('Error occurred');

    // Should clean up status message and post error to Slack
    expect(mockCleanupStatusMessage).toHaveBeenCalledWith('C123', '1700000000.000000', 'agent-1');
    const errorCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][3]).toContain('Error occurred');
  });

  it('should report user-friendly error message for exit code 137 (SIGKILL)', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 137,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"some raw container logs","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toContain('Task failed with exit code 137');

    // Should await cleanupStatusMessage before posting error
    expect(mockCleanupStatusMessage).toHaveBeenCalledWith('C123', '1700000000.000000', 'agent-1');

    // Error message posted to Slack should be user-friendly, not raw logs
    const errorCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][3]).toContain('ran out of time or resources');
    expect(errorCalls[0][3]).toContain('minutes');
    // Should NOT contain the raw container output
    expect(errorCalls[0][3]).not.toContain('some raw container logs');
  });

  it('should handle missing TINYHANDS_OUTPUT with stream-json fallback', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: '{"type":"result","subtype":"success","result":"fallback output"}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toBe('fallback output');
  });

  it('should use allLogs tail as fallback when no markers found', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'Some raw log output here\nMore lines',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toContain('Some raw log output');
  });

  it('should record token usage after container completes', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":100,"output_tokens":50,"tool_calls_count":0,"cost_usd":0.005}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockRecordTokenUsage).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 150); // 100 + 50
  });

  it('should use estimateCost when cost_usd is 0', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":100,"output_tokens":50,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockEstimateCost).toHaveBeenCalledWith('sonnet', 100, 50);
  });

  it('should inject context from retrieveContext', async () => {
    mockRetrieveContext.mockResolvedValue([
      { file_path: 'doc.txt', content: 'Relevant info here' },
    ]);
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":50,"output_tokens":20,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // createAgentContainer should have been called with TASK_PROMPT containing context
    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.envVars.TASK_PROMPT).toContain('Relevant Context');
    expect(containerCall.envVars.TASK_PROMPT).toContain('doc.txt');
  });

  it('should inject memories when memory_enabled is true', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    mockRetrieveMemories.mockResolvedValue([
      { category: 'preference', fact: 'User likes JSON format' },
    ]);
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":50,"output_tokens":20,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockRetrieveMemories).toHaveBeenCalledWith('W_TEST_123', 'agent-1', 'Hello, run a task');
    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.envVars.TASK_PROMPT).toContain('Agent Memory');
    expect(containerCall.envVars.TASK_PROMPT).toContain('User likes JSON format');
  });

  it('should not retrieve memories when memory_enabled is false', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: false }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":50,"output_tokens":20,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockRetrieveMemories).not.toHaveBeenCalled();
  });

  it('should handle context retrieval failure gracefully', async () => {
    mockRetrieveContext.mockRejectedValue(new Error('Source unavailable'));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    // Should not throw — context errors are caught
    const result = await executeAgentRun(job);
    expect(result).toBe('done');
  });

  it('should buffer events to Slack', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should have buffered initial 'thinking' status and 'done' events
    const thinkingCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'thinking');
    expect(thinkingCalls.length).toBeGreaterThanOrEqual(1);

    const doneCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'done');
    expect(doneCalls.length).toBe(1);
  });

  it('should detect tool_use from complete assistant messages in stream-json', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    // Mock followContainerOutput to invoke the streaming callback with assistant messages
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      // Simulate Claude Code stream-json complete assistant messages
      callback(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'Let me think...' }] } }));
      callback(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'WebSearch', input: { query: 'test' } }] } }));
      callback(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } }] } }));
      callback(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Here is the result...' }] } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":100,"output_tokens":50,"tool_calls_count":2,"cost_usd":0.005}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should have detected tool_use events from assistant messages
    const toolUseCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'tool_use');
    expect(toolUseCalls.length).toBe(2);
    expect(toolUseCalls[0][3]).toBe('WebSearch');
    expect(toolUseCalls[1][3]).toBe('Bash');

    // Should have detected text → "Writing response..."
    const writingCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'thinking' && c[3] === 'Writing response...');
    expect(writingCalls.length).toBe(1);
  });

  it('should set status message TS when provided in job data', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData({ statusMessageTs: '123.456' }));
    await executeAgentRun(job);

    expect(mockSetStatusMessageTs).toHaveBeenCalledWith('C123', '1700000000.000000', '123.456', 'agent-1');
  });

  it('should handle container error (timeout) and update run record', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockRejectedValue(new Error('Container creation timed out'));

    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('timed out');

    // Should have updated run record with timeout status
    const timeoutUpdate = mockExecute.mock.calls.find(
      (c: any[]) => c[0].includes('UPDATE run_history') && c[1]?.includes('timeout')
    );
    expect(timeoutUpdate).toBeDefined();
  });

  it('should handle container error (non-timeout) and update run record', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockRejectedValue(new Error('Docker daemon error'));

    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('Docker daemon error');

    // Should have updated run record with failed status
    const failedUpdate = mockExecute.mock.calls.find(
      (c: any[]) => c[0].includes('UPDATE run_history') && c[1]?.includes('failed')
    );
    expect(failedUpdate).toBeDefined();
  });

  it('should clean up status message and buffer error event to Slack on failure', async () => {
    mockCreateAgentContainer.mockRejectedValue(new Error('Crash'));

    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow('Crash');

    // Should clean up the "Thinking..." status message before posting error
    expect(mockCleanupStatusMessage).toHaveBeenCalledWith('C123', '1700000000.000000', 'agent-1');

    const errorCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][3]).toBe('Crash');
  });

  it('should clean up status message and buffer timeout-specific error on timeout', async () => {
    mockCreateAgentContainer.mockRejectedValue(new Error('Container timed out after 60s'));

    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow();

    // Should clean up the "Thinking..." status message
    expect(mockCleanupStatusMessage).toHaveBeenCalledWith('C123', '1700000000.000000', 'agent-1');

    const errorCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][3]).toContain('timed out');
  });

  it('should not buffer Slack events when channelId is empty', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"done","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData({ channelId: '' }));
    await executeAgentRun(job);

    expect(mockBufferEvent).not.toHaveBeenCalled();
  });

  it('should log run events for thinking and done phases', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const thinkingEvent = mockLogRunEvent.mock.calls.find((c: any[]) => c[0].event_type === 'thinking');
    expect(thinkingEvent).toBeDefined();

    const doneEvent = mockLogRunEvent.mock.calls.find((c: any[]) => c[0].event_type === 'done');
    expect(doneEvent).toBeDefined();
  });

  it('should call removeContainer after completion', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockRemoveContainer).toHaveBeenCalledWith(container);
  });

  it('should use haiku model with suppress thinking', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ model: 'haiku' }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Initial thinking status should never be suppressed (even for haiku)
    const thinkingCall = mockBufferEvent.mock.calls.find((c: any[]) => c[2] === 'thinking');
    expect(thinkingCall).toBeDefined();
    expect(thinkingCall![6]).toBe(false); // suppressThinking = false for status updates
  });

  it('should handle log parse errors gracefully', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{invalid json!',
    });

    // The JSON.parse in the try block will fail, going to catch
    const job = makeFakeJob(makeJobData());
    // Should still complete since the catch block handles parse errors
    const result = await executeAgentRun(job);
    expect(typeof result).toBe('string');
  });

  it('should use modelOverride from job data when present', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData({ modelOverride: 'opus' }));
    await executeAgentRun(job);

    // getModelId should have been called with 'opus'
    expect(mockGetModelId).toHaveBeenCalledWith('opus');
  });

  it('should always pass networkAllowlist with wildcard to container', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.networkAllowlist).toEqual(['*']);
  });

  // ── Skills, Custom Tools, MCP configs, Code Artifacts loading ──

  it('should load and pass skills config to container', async () => {
    mockGetAgentSkills.mockResolvedValue([
      { name: 'my-skill', skill_type: 'prompt', config_json: '{"template":"hello"}', permission_level: 'read' },
    ]);

    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    const skills = JSON.parse(containerCall.envVars.SKILLS_CONFIG);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-skill');
    expect(skills[0].type).toBe('prompt');
    expect(skills[0].config).toEqual({ template: 'hello' });
    expect(skills[0].permission_level).toBe('read');
  });

  it('should load custom tools matching agent.tools and pass to container', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ tools: ['my-custom-tool'] }));
    mockListCustomTools.mockResolvedValue([
      { name: 'my-custom-tool', schema_json: '{"type":"object"}', script_path: '/scripts/tool.js', language: 'javascript', config_json: null },
      { name: 'other-tool', schema_json: '{}', script_path: '/scripts/other.js', language: 'python', config_json: '{"x":1}' },
    ]);
    mockGetToolExecutionScript.mockResolvedValue('console.log("hello")');

    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    const customTools = JSON.parse(containerCall.envVars.CUSTOM_TOOLS_CONFIG);
    expect(customTools).toHaveLength(1);
    expect(customTools[0].name).toBe('my-custom-tool');
    expect(customTools[0].schema).toEqual({ type: 'object' });
    expect(customTools[0].script_code).toBe('console.log("hello")');
    expect(customTools[0].config).toEqual({}); // config_json was null, falls back to '{}'
  });

  it('should load approved MCP configs and merge with skills', async () => {
    mockGetMcpConfigs.mockResolvedValue([
      { name: 'mcp-server', config_json: '{"url":"http://localhost"}', approved: true },
      { name: 'unapproved-mcp', config_json: '{}', approved: false },
    ]);

    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    const skills = JSON.parse(containerCall.envVars.SKILLS_CONFIG);
    expect(skills).toHaveLength(1); // Only the approved one
    expect(skills[0].name).toBe('mcp-server');
    expect(skills[0].type).toBe('mcp');
    expect(skills[0].permission_level).toBe('write');
  });

  it('should load code artifacts and pass to container', async () => {
    mockGetCodeArtifacts.mockResolvedValue([
      { file_path: '/workspace/main.py', content: 'print("hello")', language: 'python' },
    ]);

    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    const artifacts = JSON.parse(containerCall.envVars.CODE_ARTIFACTS_CONFIG);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].file_path).toBe('/workspace/main.py');
    expect(artifacts[0].content).toBe('print("hello")');
  });

  it('should handle skills/tools loading failure gracefully', async () => {
    mockGetAgentSkills.mockRejectedValue(new Error('Skills DB error'));

    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    // Should not throw - skills loading errors are caught
    expect(result).toBe('ok');
    // Skills config should remain as empty array default
    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.envVars.SKILLS_CONFIG).toBe('[]');
  });

  // ── Content block start events (granular stream format) ──

  it('should detect content_block_start tool_use events from granular stream', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'Read' } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":1,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const toolUseCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'tool_use');
    expect(toolUseCalls.length).toBe(1);
    expect(toolUseCalls[0][3]).toBe('Read');
  });

  it('should detect content_block_start thinking events from granular stream', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking' } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should have initial thinking + content_block_start thinking
    const thinkingCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'thinking' && c[3] === 'Thinking...');
    expect(thinkingCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('should detect content_block_start text events from granular stream', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'text' } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const writingCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'thinking' && c[3] === 'Writing response...');
    expect(writingCalls.length).toBe(1);
  });

  it('should not duplicate thinking status for consecutive content_block_start thinking events', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      // Two consecutive thinking events - second should be suppressed
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking' } }));
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'thinking' } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Initial thinking + one content_block_start thinking (second suppressed because lastStreamEventType === 'thinking')
    const thinkingCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'thinking' && c[3] === 'Thinking...');
    expect(thinkingCalls.length).toBe(2); // initial + first content_block_start
  });

  it('should use tool name "tool" as fallback for content_block_start without name', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      callback(JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use' } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":1,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const toolUseCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'tool_use');
    expect(toolUseCalls.length).toBe(1);
    expect(toolUseCalls[0][3]).toBe('tool');
  });

  // ── Empty output patterns ──

  it('should treat "(No output)" as empty output and silently clean up', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"(No output)","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    // The output is the trimmed string since it's truthy, but Slack should not post done event
    expect(result).toBe('(No output)');
    expect(mockCleanupStatusMessage).toHaveBeenCalled();
    // Should NOT post a done event to Slack (agentProducedOutput is false)
    const doneCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'done');
    expect(doneCalls).toHaveLength(0);
  });

  it('should treat "No output" as empty output and silently clean up', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"No output","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toBe('No output');
    expect(mockCleanupStatusMessage).toHaveBeenCalled();
    const doneCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'done');
    expect(doneCalls).toHaveLength(0);
  });

  it('should treat "Agent completed but no structured result captured" as empty output', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Agent completed but no structured result captured","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toBe('Agent completed but no structured result captured');
    expect(mockCleanupStatusMessage).toHaveBeenCalled();
    const doneCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'done');
    expect(doneCalls).toHaveLength(0);
  });

  // ── Log parse error recovery ──

  it('should handle log parse errors gracefully with best-effort container cleanup', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    // Make removeContainer throw on the first call (the one inside the try block at line 371)
    // but the log parse itself fails
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{invalid json that will cause parse error',
    });
    // Make the first removeContainer call throw (this is the one inside the try)
    mockRemoveContainer
      .mockRejectedValueOnce(new Error('container not found'))
      .mockResolvedValue(undefined);

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    // Should still complete (logErr catch block handles parse error)
    expect(typeof result).toBe('string');
    // Should have attempted removeContainer in the catch block (best-effort)
    expect(mockRemoveContainer).toHaveBeenCalled();
  });

  // ── Memory extraction ──

  it('should extract and store memories when memory_enabled and run completed', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Here is the result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '[{"fact":"User prefers JSON","category":"preference"}]' }],
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockAnthropicCreate).toHaveBeenCalled();
    expect(mockStoreMemories).toHaveBeenCalledWith(
      'W_TEST_123',
      'agent-1',
      expect.any(String),
      [{ fact: 'User prefers JSON', category: 'preference' }],
    );
  });

  it('should handle memory extraction failure gracefully', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    mockAnthropicCreate.mockRejectedValue(new Error('API error'));

    const job = makeFakeJob(makeJobData());
    // Should not throw even if memory extraction fails
    const result = await executeAgentRun(job);
    expect(result).toBe('Result');
  });

  it('should not extract memories when memory is disabled', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: false }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockStoreMemories).not.toHaveBeenCalled();
  });

  it('should not extract memories when run status is failed', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 1,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Error","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('should filter invalid categories in extracted memories', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '[{"fact":"Important info","category":"invalid_category"},{"fact":"Valid fact","category":"entity"}]' }],
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockStoreMemories).toHaveBeenCalledWith(
      'W_TEST_123',
      'agent-1',
      expect.any(String),
      expect.arrayContaining([
        { fact: 'Important info', category: 'context' }, // invalid_category -> context
        { fact: 'Valid fact', category: 'entity' },
      ]),
    );
  });

  it('should not store memories when AI returns empty array', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '[]' }],
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockStoreMemories).not.toHaveBeenCalled();
  });

  it('should limit memories to 5 facts and filter out entries without fact or category', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    const manyFacts = [
      { fact: 'Fact 1', category: 'entity' },
      { fact: 'Fact 2', category: 'preference' },
      { fact: 'Fact 3', category: 'procedure' },
      { fact: 'Fact 4', category: 'correction' },
      { fact: 'Fact 5', category: 'context' },
      { fact: 'Fact 6', category: 'entity' }, // Should be excluded (> 5)
      { fact: '', category: 'entity' }, // Should be filtered (empty fact)
      { fact: 'No category', category: '' }, // Should be filtered (empty category)
    ];

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(manyFacts) }],
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockStoreMemories).toHaveBeenCalledWith(
      'W_TEST_123',
      'agent-1',
      expect.any(String),
      expect.any(Array),
    );
    const storedFacts = mockStoreMemories.mock.calls[0][3];
    expect(storedFacts.length).toBeLessThanOrEqual(5);
  });

  it('should handle AI returning non-JSON response in memory extraction', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'This is not valid JSON at all' }],
    });

    const job = makeFakeJob(makeJobData());
    // Should not throw
    const result = await executeAgentRun(job);
    expect(result).toBe('Result');
    expect(mockStoreMemories).not.toHaveBeenCalled();
  });

  // ── Stream callback JSON parse error ──

  it('should silently ignore non-JSON lines from container output stream', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      // Send non-JSON data (e.g., stderr or TINYHANDS_OUTPUT line)
      callback('This is not JSON');
      callback('TINYHANDS_OUTPUT:{"some":"data"}');
      callback('');
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    // Should not throw
    const result = await executeAgentRun(job);
    expect(result).toBe('ok');
  });

  // ── Error with empty output ──

  it('should use exit code message when outputData.output is empty on failure', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 1,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    const result = await executeAgentRun(job);

    expect(result).toContain('Task failed with exit code 1');
    // Error event should use the fallback message
    const errorCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][3]).toContain('Task failed with exit code 1');
  });

  // ── Job with no id ──

  it('should handle job with undefined id', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    // Create a job with no id (simulating undefined job.id)
    const job = { data: makeJobData(), name: 'tinyhands-runs' } as unknown as Job<JobData>;
    await executeAgentRun(job);

    // logRunEvent should have been called with empty string for job_id (job.id || '')
    const thinkingEvent = mockLogRunEvent.mock.calls.find((c: any[]) => c[0].event_type === 'thinking');
    expect(thinkingEvent![0].job_id).toBe('');
  });

  // ── Parsed output with missing/falsy fields ──

  it('should default to 0 when parsed output fields are missing', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok"}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should have used 0 defaults for missing fields
    expect(mockRecordTokenUsage).toHaveBeenCalledWith(TEST_WORKSPACE_ID, 0); // 0 + 0
  });

  // ── system_prompt fallback ──

  it('should use empty string when agent system_prompt is null', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ system_prompt: null }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    // Base system_prompt is '' (null coerced), but permission context may be appended
    expect(containerCall.envVars.SYSTEM_PROMPT).toContain('');
    // The system prompt starts with empty string (not the agent's prompt)
    expect(containerCall.envVars.SYSTEM_PROMPT.startsWith('\n\n') || containerCall.envVars.SYSTEM_PROMPT === '').toBe(true);
  });

  // ── Error with undefined job id ──

  it('should handle error catch block with undefined job id', async () => {
    mockCreateAgentContainer.mockRejectedValue(new Error('Docker crash'));

    const job = { data: makeJobData(), name: 'tinyhands-runs' } as unknown as Job<JobData>;

    await expect(executeAgentRun(job)).rejects.toThrow('Docker crash');

    // logRunEvent in error handler should use '' for job_id
    const errorEvent = mockLogRunEvent.mock.calls.find((c: any[]) => c[0].event_type === 'error');
    expect(errorEvent![0].job_id).toBe('');
  });

  // ── Error with no message ──

  it('should use "Unknown error" when error has no message', async () => {
    const err: any = new Error();
    err.message = '';
    mockCreateAgentContainer.mockRejectedValue(err);

    const job = makeFakeJob(makeJobData());

    await expect(executeAgentRun(job)).rejects.toThrow();

    // Should have updated run record with 'Unknown error'
    const updateCall = mockExecute.mock.calls.find(
      (c: any[]) => c[0].includes('UPDATE run_history') && c[1]?.includes('Unknown error')
    );
    expect(updateCall).toBeDefined();
  });

  // ── Error without channelId ──

  it('should not buffer Slack error events when channelId is empty on failure', async () => {
    mockCreateAgentContainer.mockRejectedValue(new Error('Docker error'));

    const job = makeFakeJob(makeJobData({ channelId: '' }));
    await expect(executeAgentRun(job)).rejects.toThrow('Docker error');

    expect(mockCleanupStatusMessage).not.toHaveBeenCalled();
    expect(mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'error')).toHaveLength(0);
  });

  // ── streaming_detail flag ──

  it('should pass STREAMING_DETAIL=1 when agent has streaming_detail enabled', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ streaming_detail: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.envVars.STREAMING_DETAIL).toBe('1');
  });

  // ── context block with no context ──

  it('should not include context block in task prompt when no context or memories', async () => {
    mockRetrieveContext.mockResolvedValue([]);
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const containerCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(containerCall.envVars.TASK_PROMPT).not.toContain('Relevant Context');
  });

  // ── Format 1 assistant message tool_use with no name ──

  it('should use "tool" as fallback name for assistant message tool_use without name', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockImplementation(async (_container: any, callback: (line: string) => void, _timeout: number) => {
      callback(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1' }] } }));
      return {
        exitCode: 0,
        allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":1,"cost_usd":0}',
      };
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const toolUseCalls = mockBufferEvent.mock.calls.filter((c: any[]) => c[2] === 'tool_use');
    expect(toolUseCalls.length).toBe(1);
    expect(toolUseCalls[0][3]).toBe('tool');
  });

  // ── memory extraction outer catch (line 433-434) ──

  it('should catch memory extraction errors at the outer level', async () => {
    mockGetAgent.mockResolvedValue(makeAgent({ memory_enabled: true }));
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"Result","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    // Make the Anthropic API call fail, AND make logger.warn throw when called
    // from the inner catch. This causes the inner catch handler to throw,
    // which propagates to the outer catch at lines 432-434.
    mockAnthropicCreate.mockRejectedValue(new Error('API crash'));
    // The first logger.warn call during this run will be from the inner catch
    // of extractAndStoreMemories ('AI memory extraction failed').
    // Make it throw to trigger the outer catch.
    mockLoggerWarn.mockImplementationOnce(() => {
      throw new Error('Logger itself crashed');
    });

    const job = makeFakeJob(makeJobData());
    // Should not throw - outer catch handles it
    const result = await executeAgentRun(job);
    expect(result).toBe('Result');
    // The outer catch should have logged the warning
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Memory extraction failed',
      expect.objectContaining({ error: expect.stringContaining('Logger itself crashed') }),
    );
  });

  // ── cost_usd > 0 path ──

  it('should use cost_usd from container output when positive', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":100,"output_tokens":50,"tool_calls_count":0,"cost_usd":0.123}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    // Should NOT call estimateCost when cost_usd > 0
    expect(mockEstimateCost).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════
//  Permission Context Injection
// ══════════════════════════════════════════════════

describe('Execution Module – Permission Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockResolvedValue(makeAgent());
    mockExecute.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockCheckRequestRate.mockResolvedValue(true);
    mockRetrieveContext.mockResolvedValue([]);
    mockRemoveContainer.mockResolvedValue(undefined);
    mockGetAgentSkills.mockResolvedValue([]);
    mockListCustomTools.mockResolvedValue([]);
    mockGetMcpConfigs.mockResolvedValue([]);
    mockGetCodeArtifacts.mockResolvedValue([]);
  });

  it('should inject viewer permission context into SYSTEM_PROMPT', async () => {
    mockGetAgentRole.mockResolvedValue('viewer');
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const createCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(createCall.envVars.SYSTEM_PROMPT).toContain('access level: viewer');
    expect(createCall.envVars.SYSTEM_PROMPT).toContain('viewer-level access');
  });

  it('should inject member permission context into SYSTEM_PROMPT', async () => {
    mockGetAgentRole.mockResolvedValue('member');
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const createCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(createCall.envVars.SYSTEM_PROMPT).toContain('access level: member');
    expect(createCall.envVars.SYSTEM_PROMPT).not.toContain('viewer-level access');
  });

  it('should inject owner permission context into SYSTEM_PROMPT', async () => {
    mockGetAgentRole.mockResolvedValue('owner');
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const createCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(createCall.envVars.SYSTEM_PROMPT).toContain('access level: owner');
  });

  it('should include write_policy=deny note when agent has deny policy', async () => {
    mockGetAgentRole.mockResolvedValue('viewer');
    mockGetAgent.mockResolvedValue({ ...makeAgent(), write_policy: 'deny' });
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    const createCall = mockCreateAgentContainer.mock.calls[0][0];
    expect(createCall.envVars.SYSTEM_PROMPT).toContain('Write operations are disabled');
  });

  it('should log audit event after run completes', async () => {
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0.001}',
    });

    const job = makeFakeJob(makeJobData());
    await executeAgentRun(job);

    expect(mockLogAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'tool_invocation',
      agentId: 'agent-1',
    }));
  });
});

// ══════════════════════════════════════════════════
//  createWorker
// ══════════════════════════════════════════════════

describe('Execution Module – createWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture the processor function that calls executeAgentRun', async () => {
    // Reset captured processor
    capturedWorkerProcessor = null;
    createWorker();
    expect(capturedWorkerProcessor).toBeDefined();
    expect(typeof capturedWorkerProcessor).toBe('function');

    // The processor should call executeAgentRun when invoked
    // We need to set up mocks for a successful run
    mockGetAgent.mockResolvedValue(makeAgent());
    mockExecute.mockResolvedValue(undefined);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockCheckRequestRate.mockResolvedValue(true);
    mockRetrieveContext.mockResolvedValue([]);
    mockRemoveContainer.mockResolvedValue(undefined);
    mockGetAgentSkills.mockResolvedValue([]);
    mockListCustomTools.mockResolvedValue([]);
    mockGetMcpConfigs.mockResolvedValue([]);
    mockGetCodeArtifacts.mockResolvedValue([]);
    const container = { id: 'container-1' };
    mockCreateAgentContainer.mockResolvedValue(container);
    mockFollowContainerOutput.mockResolvedValue({
      exitCode: 0,
      allLogs: 'TINYHANDS_OUTPUT:{"output":"processor ok","input_tokens":10,"output_tokens":5,"tool_calls_count":0,"cost_usd":0}',
    });

    const fakeJob = makeFakeJob(makeJobData());
    const result = await capturedWorkerProcessor(fakeJob);
    expect(result).toBe('processor ok');
  });

  it('should create a BullMQ Worker and register event handlers', () => {
    const worker = createWorker();

    // Should have registered 'completed' and 'failed' handlers
    expect(mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('should log on job completion', () => {
    createWorker();

    // Find the 'completed' handler
    const completedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'completed');
    expect(completedCall).toBeDefined();
    const completedHandler = completedCall![1];

    // Invoke the handler
    const fakeJob = { id: 'job-42', data: { traceId: 'trace-xyz' } };
    completedHandler(fakeJob);

    expect(mockLoggerInfo).toHaveBeenCalledWith('Job completed', { jobId: 'job-42', traceId: 'trace-xyz' });
  });

  it('should log on job failure', () => {
    createWorker();

    const failedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'failed');
    expect(failedCall).toBeDefined();
    const failedHandler = failedCall![1];

    const fakeJob = { id: 'job-42', data: { traceId: 'trace-xyz' } };
    failedHandler(fakeJob, new Error('Some generic error'));

    expect(mockLoggerError).toHaveBeenCalledWith('Job failed', { jobId: 'job-42', error: 'Some generic error' });
  });

  it('should pause and resume worker on 429 rate limit error', async () => {
    vi.useFakeTimers();

    createWorker();

    const failedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'failed');
    const failedHandler = failedCall![1];

    const fakeJob = { id: 'job-42', data: { traceId: 'trace-xyz' } };
    failedHandler(fakeJob, new Error('Anthropic 429 Too Many Requests'));

    expect(mockLoggerWarn).toHaveBeenCalledWith('Anthropic 429 detected, pausing worker', { retryAfter: 60 });

    // pause should have been called
    expect(mockWorkerPause).toHaveBeenCalled();

    // Wait for pause to resolve
    await vi.runAllTimersAsync();

    // After 60s, resume should be called
    vi.advanceTimersByTime(60000);
    expect(mockWorkerResume).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should pause and resume worker on rate limit error message', async () => {
    vi.useFakeTimers();

    createWorker();

    const failedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'failed');
    const failedHandler = failedCall![1];

    const fakeJob = { id: 'job-42', data: { traceId: 'trace-xyz' } };
    failedHandler(fakeJob, new Error('rate limit exceeded'));

    expect(mockWorkerPause).toHaveBeenCalled();

    await vi.runAllTimersAsync();
    vi.advanceTimersByTime(60000);
    expect(mockWorkerResume).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('should handle failure with null job', () => {
    createWorker();

    const failedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'failed');
    const failedHandler = failedCall![1];

    // Job can be undefined in some BullMQ failure scenarios
    failedHandler(undefined, new Error('Unknown error'));

    expect(mockLoggerError).toHaveBeenCalledWith('Job failed', { jobId: undefined, error: 'Unknown error' });
  });

  it('should not pause worker for non-rate-limit errors', () => {
    createWorker();

    const failedCall = mockWorkerOn.mock.calls.find((c: any[]) => c[0] === 'failed');
    const failedHandler = failedCall![1];

    const fakeJob = { id: 'job-42', data: { traceId: 'trace-xyz' } };
    failedHandler(fakeJob, new Error('Some random error'));

    expect(mockWorkerPause).not.toHaveBeenCalled();
  });
});
