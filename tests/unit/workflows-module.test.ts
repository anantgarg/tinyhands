import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_WORKSPACE_ID = 'W_TEST_123';

// ── Mock setup ──
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockWithTransaction = vi.fn();
const mockEnqueueRun = vi.fn();

vi.mock('../../src/db', () => ({
  query: (...args: any[]) => mockQuery(...args),
  queryOne: (...args: any[]) => mockQueryOne(...args),
  execute: (...args: any[]) => mockExecute(...args),
  withTransaction: (fn: any) => mockWithTransaction(fn),
}));

vi.mock('../../src/queue', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import {
  createWorkflowDefinition,
  getWorkflowDefinition,
  startWorkflow,
  getWorkflowRun,
  getActiveWorkflowRuns,
  executeStep,
  advanceWorkflow,
  resolveHumanAction,
  completeWorkflow,
  failWorkflow,
  recordSideEffect,
  getExpiredTimers,
  processExpiredTimers,
} from '../../src/modules/workflows/index';

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════
// Workflow Definition CRUD
// ═══════════════════════════════════════════════════

describe('createWorkflowDefinition', () => {
  it('should create a workflow definition and insert into DB', async () => {
    const steps = [
      { id: 'step-1', type: 'agent_run' as const, config: { prompt: 'Do something' } },
    ];

    const result = await createWorkflowDefinition(TEST_WORKSPACE_ID, 'My Workflow', 'agent-1', steps, 'user1');

    expect(result.id).toBe('test-uuid-1234');
    expect(result.name).toBe('My Workflow');
    expect(result.agent_id).toBe('agent-1');
    expect(result.steps_json).toBe(JSON.stringify(steps));
    expect(result.created_by).toBe('user1');
    expect(result.created_at).toBeDefined();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_definitions'),
      expect.arrayContaining(['test-uuid-1234', TEST_WORKSPACE_ID, 'My Workflow', 'agent-1']),
    );
  });

  it('should serialize multiple steps to JSON', async () => {
    const steps = [
      { id: 's1', type: 'agent_run' as const, config: { prompt: 'A' } },
      { id: 's2', type: 'timer' as const, config: { delay_ms: 5000 } },
      { id: 's3', type: 'human_action' as const, config: {} },
    ];

    const result = await createWorkflowDefinition(TEST_WORKSPACE_ID, 'Multi-step', 'agent-1', steps, 'user1');

    const parsed = JSON.parse(result.steps_json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].type).toBe('agent_run');
    expect(parsed[1].type).toBe('timer');
    expect(parsed[2].type).toBe('human_action');
  });
});

describe('getWorkflowDefinition', () => {
  it('should return a workflow definition by id', async () => {
    const def = { id: 'wf-1', name: 'Test', agent_id: 'a1', steps_json: '[]' };
    mockQueryOne.mockResolvedValue(def);

    const result = await getWorkflowDefinition(TEST_WORKSPACE_ID, 'wf-1');
    expect(result).toEqual(def);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM workflow_definitions WHERE id = $1'),
      expect.arrayContaining(['wf-1']),
    );
  });

  it('should return null when definition does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await getWorkflowDefinition(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });

  it('should return null for undefined queryOne result', async () => {
    mockQueryOne.mockResolvedValue(undefined);
    const result = await getWorkflowDefinition(TEST_WORKSPACE_ID, 'nope');
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// Workflow Execution
// ═══════════════════════════════════════════════════

describe('startWorkflow', () => {
  it('should create a workflow run and execute the first step', async () => {
    const definition = {
      id: 'wf-1',
      name: 'Test',
      agent_id: 'agent-1',
      steps_json: JSON.stringify([
        { id: 'step-1', type: 'agent_run', config: { prompt: 'Hello' } },
      ]),
      created_by: 'user1',
    };
    // First call: getWorkflowDefinition in startWorkflow
    // Second call: getWorkflowDefinition in executeStep
    mockQueryOne
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce(definition);

    const result = await startWorkflow(TEST_WORKSPACE_ID, 'wf-1');

    expect(result.workflow_id).toBe('wf-1');
    expect(result.current_step).toBe(0);
    expect(result.status).toBe('running');
    expect(result.waiting_for).toBeNull();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_runs'),
      expect.any(Array),
    );
    // executeStep should enqueue the first agent_run
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TEST_WORKSPACE_ID,
        agentId: 'agent-1',
        input: 'Hello',
        workflowRunId: result.id,
        workflowStepIndex: 0,
      }),
      'normal',
    );
  });

  it('should throw when workflow definition does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(startWorkflow(TEST_WORKSPACE_ID, 'nonexistent')).rejects.toThrow('Workflow nonexistent not found');
  });
});

describe('executeStep', () => {
  const makeRun = (overrides = {}): any => ({
    id: 'run-1',
    workflow_id: 'wf-1',
    run_id: 'run-id-1',
    current_step: 0,
    step_state: '{}',
    waiting_for: null,
    wait_until: null,
    status: 'running',
    ...overrides,
  });

  it('should complete workflow when current_step >= steps length', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([{ id: 's1', type: 'agent_run', config: {} }]),
      agent_id: 'a1',
    };
    mockQueryOne.mockResolvedValue(definition);

    const run = makeRun({ current_step: 1 }); // 1 step, index 1 = past end
    await executeStep(TEST_WORKSPACE_ID, run);

    // Should call completeWorkflow -> updateWorkflowRun with status='completed'
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['completed']),
    );
  });

  it('should fail workflow when MAX_WORKFLOW_STEPS exceeded', async () => {
    const steps = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      type: 'agent_run',
      config: {},
    }));
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify(steps),
      agent_id: 'a1',
    };
    mockQueryOne.mockResolvedValue(definition);

    const run = makeRun({ current_step: 20 }); // MAX_WORKFLOW_STEPS = 20
    await executeStep(TEST_WORKSPACE_ID, run);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['failed']),
    );
  });

  it('should throw when workflow definition not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    const run = makeRun();

    await expect(executeStep(TEST_WORKSPACE_ID, run)).rejects.toThrow('Workflow wf-1 not found');
  });

  it('should enqueue a run for agent_run step type', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        {
          id: 'step-1',
          type: 'agent_run',
          config: { prompt: 'Run this', channel_id: 'C123', thread_ts: '123.456' },
        },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne.mockResolvedValue(definition);

    await executeStep(TEST_WORKSPACE_ID, makeRun());

    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: TEST_WORKSPACE_ID,
        agentId: 'agent-1',
        channelId: 'C123',
        threadTs: '123.456',
        input: 'Run this',
        workflowRunId: 'run-1',
        workflowStepIndex: 0,
      }),
      'normal',
    );
  });

  it('should default channel_id and thread_ts to empty strings for agent_run', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 'step-1', type: 'agent_run', config: { prompt: 'Go' } },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne.mockResolvedValue(definition);

    await executeStep(TEST_WORKSPACE_ID, makeRun());

    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: '',
        threadTs: '',
      }),
      'normal',
    );
  });

  it('should set waiting_for=timer and status=waiting for timer step', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 'step-1', type: 'timer', config: { delay_ms: 30000 } },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne.mockResolvedValue(definition);

    await executeStep(TEST_WORKSPACE_ID, makeRun());

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['timer', 'waiting']),
    );
  });

  it('should use default 60000ms delay when delay_ms is not set in timer config', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 'step-1', type: 'timer', config: {} },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne.mockResolvedValue(definition);

    const beforeMs = Date.now();
    await executeStep(TEST_WORKSPACE_ID, makeRun());

    const callArgs = mockExecute.mock.calls[0];
    const values = callArgs[1];
    // Find the wait_until value (an ISO string)
    const waitUntilStr = values.find((v: any) => typeof v === 'string' && v.includes('T'));
    const waitUntilMs = new Date(waitUntilStr).getTime();
    // Should be ~60 seconds from now
    expect(waitUntilMs - beforeMs).toBeGreaterThanOrEqual(59000);
    expect(waitUntilMs - beforeMs).toBeLessThan(62000);
  });

  it('should set waiting_for=human_action and status=waiting for human_action step', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 'step-1', type: 'human_action', config: {} },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne.mockResolvedValue(definition);

    await executeStep(TEST_WORKSPACE_ID, makeRun());

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['human_action', 'waiting']),
    );
  });

  it('should evaluate condition step and branch on success', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        {
          id: 'cond-1',
          type: 'condition',
          config: { condition: { key: 'approved', value: true } },
          next_on_success: 'step-ok',
          next_on_failure: 'step-fail',
        },
        { id: 'step-ok', type: 'agent_run', config: { prompt: 'OK' } },
        { id: 'step-fail', type: 'agent_run', config: { prompt: 'Fail' } },
      ]),
      agent_id: 'agent-1',
    };
    // First: getWorkflowDefinition for executeStep (condition)
    // Then: updateWorkflowRun, then getWorkflowRun, then getWorkflowDefinition for recursive executeStep
    mockQueryOne
      .mockResolvedValueOnce(definition) // executeStep -> getWorkflowDefinition
      .mockResolvedValueOnce({ ...makeRun({ current_step: 1 }) }) // getWorkflowRun after update
      .mockResolvedValueOnce(definition); // recursive executeStep -> getWorkflowDefinition

    const run = makeRun({ step_state: JSON.stringify({ approved: true }) });
    await executeStep(TEST_WORKSPACE_ID, run);

    // Should update current_step to index of 'step-ok' (1)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining([1]),
    );
  });

  it('should evaluate condition step and branch on failure', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        {
          id: 'cond-1',
          type: 'condition',
          config: { condition: { key: 'approved', value: true } },
          next_on_success: 'step-ok',
          next_on_failure: 'step-fail',
        },
        { id: 'step-ok', type: 'agent_run', config: { prompt: 'OK' } },
        { id: 'step-fail', type: 'agent_run', config: { prompt: 'Fail' } },
      ]),
      agent_id: 'agent-1',
    };
    mockQueryOne
      .mockResolvedValueOnce(definition) // executeStep -> getWorkflowDefinition
      .mockResolvedValueOnce({ ...makeRun({ current_step: 2 }) }) // getWorkflowRun after update
      .mockResolvedValueOnce(definition); // recursive executeStep -> getWorkflowDefinition

    const run = makeRun({ step_state: JSON.stringify({ approved: false }) });
    await executeStep(TEST_WORKSPACE_ID, run);

    // Should update current_step to index of 'step-fail' (2)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining([2]),
    );
  });

  it('should advance workflow when condition has no matching next step', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        {
          id: 'cond-1',
          type: 'condition',
          config: { condition: { key: 'flag', value: 'yes' } },
          // no next_on_success or next_on_failure
        },
      ]),
      agent_id: 'agent-1',
    };
    // getWorkflowDefinition for executeStep
    // getWorkflowRun for advanceWorkflow
    // getWorkflowRun for advanceWorkflow's recursive executeStep call
    // getWorkflowDefinition for that executeStep
    mockQueryOne
      .mockResolvedValueOnce(definition)
      .mockResolvedValueOnce(makeRun({ current_step: 0 })) // advanceWorkflow -> getWorkflowRun
      .mockResolvedValueOnce(makeRun({ current_step: 1 })) // updated run after advance
      .mockResolvedValueOnce(definition); // recursive executeStep -> getWorkflowDefinition

    const run = makeRun({ step_state: '{}' });
    await executeStep(TEST_WORKSPACE_ID, run);

    // advanceWorkflow should have been called (increments current_step)
    expect(mockExecute).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════
// Workflow Lifecycle
// ═══════════════════════════════════════════════════

describe('advanceWorkflow', () => {
  it('should increment step and continue execution', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 's1', type: 'agent_run', config: { prompt: 'A' } },
        { id: 's2', type: 'agent_run', config: { prompt: 'B' } },
      ]),
      agent_id: 'agent-1',
    };
    // getWorkflowRun for advanceWorkflow
    // getWorkflowRun for executeStep
    // getWorkflowDefinition for executeStep
    mockQueryOne
      .mockResolvedValueOnce({ id: 'run-1', current_step: 0, status: 'waiting' })
      .mockResolvedValueOnce({ id: 'run-1', current_step: 1, status: 'running' })
      .mockResolvedValueOnce(definition);

    await advanceWorkflow(TEST_WORKSPACE_ID, 'run-1');

    // Should update with next step, clear waiting
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining([1, null, null, 'running']),
    );
  });

  it('should do nothing when workflow run does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await advanceWorkflow(TEST_WORKSPACE_ID, 'nonexistent');

    // Only the queryOne call, no execute for update
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('resolveHumanAction', () => {
  it('should merge action data into step_state and advance', async () => {
    const definition = {
      id: 'wf-1',
      steps_json: JSON.stringify([
        { id: 's1', type: 'human_action', config: {} },
        { id: 's2', type: 'agent_run', config: { prompt: 'Done' } },
      ]),
      agent_id: 'agent-1',
    };
    const run = {
      id: 'run-1',
      workflow_id: 'wf-1',
      current_step: 0,
      step_state: '{"existing":"data"}',
      waiting_for: 'human_action',
      status: 'waiting',
    };
    // getWorkflowRun for resolveHumanAction
    // getWorkflowRun for advanceWorkflow
    // getWorkflowRun for executeStep (via advanceWorkflow)
    // getWorkflowDefinition for executeStep
    mockQueryOne
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, current_step: 0, step_state: '{"existing":"data","approved":true}' })
      .mockResolvedValueOnce({ ...run, current_step: 1, status: 'running' })
      .mockResolvedValueOnce(definition);

    await resolveHumanAction(TEST_WORKSPACE_ID, 'run-1', { approved: true });

    // Should merge state
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining([JSON.stringify({ existing: 'data', approved: true })]),
    );
  });

  it('should throw when workflow is not waiting for human action', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'run-1',
      waiting_for: 'timer',
      status: 'waiting',
    });

    await expect(resolveHumanAction(TEST_WORKSPACE_ID, 'run-1', {}))
      .rejects.toThrow('Workflow is not waiting for human action');
  });

  it('should throw when workflow run does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);

    await expect(resolveHumanAction(TEST_WORKSPACE_ID, 'nonexistent', {}))
      .rejects.toThrow('Workflow is not waiting for human action');
  });
});

describe('completeWorkflow', () => {
  it('should set status to completed', async () => {
    await completeWorkflow(TEST_WORKSPACE_ID, 'run-1');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['completed']),
    );
  });
});

describe('failWorkflow', () => {
  it('should set status to failed', async () => {
    await failWorkflow(TEST_WORKSPACE_ID, 'run-1', 'Something went wrong');

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE workflow_runs SET'),
      expect.arrayContaining(['failed']),
    );
  });
});

describe('getWorkflowRun', () => {
  it('should return a workflow run by id', async () => {
    const run = { id: 'run-1', workflow_id: 'wf-1', status: 'running' };
    mockQueryOne.mockResolvedValue(run);

    const result = await getWorkflowRun(TEST_WORKSPACE_ID, 'run-1');
    expect(result).toEqual(run);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM workflow_runs WHERE id = $1'),
      expect.arrayContaining(['run-1']),
    );
  });

  it('should return null when run does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await getWorkflowRun(TEST_WORKSPACE_ID, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('getActiveWorkflowRuns', () => {
  it('should return running and waiting workflow runs', async () => {
    const runs = [
      { id: 'r1', status: 'running' },
      { id: 'r2', status: 'waiting' },
    ];
    mockQuery.mockResolvedValue(runs);

    const result = await getActiveWorkflowRuns();
    expect(result).toEqual(runs);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM workflow_runs WHERE status IN ($1, $2)',
      ['running', 'waiting'],
    );
  });
});

// ═══════════════════════════════════════════════════
// Side Effects Idempotency
// ═══════════════════════════════════════════════════

describe('recordSideEffect', () => {
  it('should record a new side effect and return true', async () => {
    mockQueryOne.mockResolvedValue(null); // no existing record

    const result = await recordSideEffect(TEST_WORKSPACE_ID, 'run-1', 'step-1', 'send_email', { to: 'a@b.com' });

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO side_effects_log'),
      expect.arrayContaining(['run-1', 'step-1', 1, 'send_email']),
    );
  });

  it('should skip duplicate side effect and return false', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing' }); // already recorded

    const result = await recordSideEffect(TEST_WORKSPACE_ID, 'run-1', 'step-1', 'send_email', { to: 'a@b.com' });

    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('should pass attempt number to insert', async () => {
    mockQueryOne.mockResolvedValue(null);

    await recordSideEffect(TEST_WORKSPACE_ID, 'run-1', 'step-1', 'send_slack', { channel: 'C1' }, 3);

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO side_effects_log'),
      expect.arrayContaining([3, 'send_slack']),
    );
  });

  it('should default attempt_number to 1', async () => {
    mockQueryOne.mockResolvedValue(null);

    await recordSideEffect(TEST_WORKSPACE_ID, 'run-1', 'step-1', 'webhook', {});

    const insertArgs = mockExecute.mock.calls[0][1];
    expect(insertArgs).toContain(1);
  });
});

// ═══════════════════════════════════════════════════
// Timer Recovery
// ═══════════════════════════════════════════════════

describe('getExpiredTimers', () => {
  it('should query for expired timer workflow runs', async () => {
    const expired = [{ id: 'r1', waiting_for: 'timer', status: 'waiting' }];
    mockQuery.mockResolvedValue(expired);

    const result = await getExpiredTimers();

    expect(result).toEqual(expired);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("waiting_for = 'timer'"),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('wait_until <= NOW()'),
    );
  });

  it('should return empty array when no timers are expired', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await getExpiredTimers();
    expect(result).toEqual([]);
  });
});

describe('processExpiredTimers', () => {
  it('should advance all expired timer workflows and return count', async () => {
    const expired = [
      { id: 'r1', current_step: 0, status: 'waiting', workspace_id: TEST_WORKSPACE_ID },
      { id: 'r2', current_step: 2, status: 'waiting', workspace_id: TEST_WORKSPACE_ID },
    ];
    mockQuery.mockResolvedValue(expired);

    // For each advanceWorkflow call: getWorkflowRun returns null (short-circuits)
    mockQueryOne.mockResolvedValue(null);

    const count = await processExpiredTimers();

    expect(count).toBe(2);
  });

  it('should return 0 when no timers are expired', async () => {
    mockQuery.mockResolvedValue([]);

    const count = await processExpiredTimers();

    expect(count).toBe(0);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});
