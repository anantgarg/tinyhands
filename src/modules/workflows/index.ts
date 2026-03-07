import { v4 as uuid } from 'uuid';
import { query } from '../../db';
import { enqueueRun } from '../../queue';
import type { WorkflowDefinition, WorkflowRun, WorkflowStatus, WaitingFor, SideEffect, JobData } from '../../types';
import { logger } from '../../utils/logger';

const MAX_WORKFLOW_STEPS = 20;

// ── Workflow Definition ──

export interface WorkflowStep {
  id: string;
  type: 'agent_run' | 'timer' | 'human_action' | 'condition';
  config: Record<string, any>;
  next_on_success?: string;
  next_on_failure?: string;
}

export async function createWorkflowDefinition(
  name: string,
  agentId: string,
  steps: WorkflowStep[],
  createdBy: string
): Promise<WorkflowDefinition> {
  const id = uuid();

  const definition: WorkflowDefinition = {
    id,
    name,
    agent_id: agentId,
    steps_json: JSON.stringify(steps),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO workflow_definitions (id, name, agent_id, steps_json, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [definition.id, definition.name, definition.agent_id,
    definition.steps_json, definition.created_by, definition.created_at]);

  logger.info('Workflow definition created', { workflowId: id, name, agentId });
  return definition;
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition | null> {
  const { rows } = await query('SELECT * FROM workflow_definitions WHERE id = $1', [id]);
  return rows[0] as WorkflowDefinition | null ?? null;
}

// ── Workflow Execution ──

export async function startWorkflow(workflowId: string): Promise<WorkflowRun> {
  const definition = await getWorkflowDefinition(workflowId);
  if (!definition) throw new Error(`Workflow ${workflowId} not found`);

  const id = uuid();
  const runId = uuid();

  const run: WorkflowRun = {
    id,
    workflow_id: workflowId,
    run_id: runId,
    current_step: 0,
    step_state: '{}',
    waiting_for: null,
    wait_until: null,
    status: 'running',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO workflow_runs (id, workflow_id, run_id, current_step, step_state,
      waiting_for, wait_until, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [run.id, run.workflow_id, run.run_id, run.current_step,
    run.step_state, run.waiting_for, run.wait_until, run.status,
    run.created_at, run.updated_at]);

  logger.info('Workflow started', { workflowRunId: id, workflowId });

  // Execute first step
  await executeStep(run);

  return run;
}

export async function getWorkflowRun(id: string): Promise<WorkflowRun | null> {
  const { rows } = await query('SELECT * FROM workflow_runs WHERE id = $1', [id]);
  return rows[0] as WorkflowRun | null ?? null;
}

export async function getActiveWorkflowRuns(): Promise<WorkflowRun[]> {
  const { rows } = await query(
    'SELECT * FROM workflow_runs WHERE status IN ($1, $2)',
    ['running', 'waiting']
  );
  return rows as WorkflowRun[];
}

export async function executeStep(run: WorkflowRun): Promise<void> {
  const definition = await getWorkflowDefinition(run.workflow_id);
  if (!definition) throw new Error(`Workflow ${run.workflow_id} not found`);

  const steps: WorkflowStep[] = JSON.parse(definition.steps_json);

  if (run.current_step >= steps.length) {
    await completeWorkflow(run.id);
    return;
  }

  if (run.current_step >= MAX_WORKFLOW_STEPS) {
    await failWorkflow(run.id, 'Max step count exceeded');
    return;
  }

  const step = steps[run.current_step];

  switch (step.type) {
    case 'agent_run': {
      const traceId = uuid();
      const jobData: JobData = {
        agentId: definition.agent_id,
        channelId: step.config.channel_id || '',
        threadTs: step.config.thread_ts || '',
        input: step.config.prompt || '',
        userId: null,
        traceId,
        workflowRunId: run.id,
        workflowStepIndex: run.current_step,
      };
      await enqueueRun(jobData, 'normal');
      break;
    }

    case 'timer': {
      const delayMs = step.config.delay_ms || 60000;
      const waitUntil = new Date(Date.now() + delayMs).toISOString();

      await updateWorkflowRun(run.id, {
        waiting_for: 'timer',
        wait_until: waitUntil,
        status: 'waiting',
      });
      break;
    }

    case 'human_action': {
      await updateWorkflowRun(run.id, {
        waiting_for: 'human_action',
        status: 'waiting',
      });
      break;
    }

    case 'condition': {
      // Evaluate condition based on accumulated step_state
      const state = JSON.parse(run.step_state);
      const conditionFn = step.config.condition;
      // Simple key-value check
      const result = state[conditionFn?.key] === conditionFn?.value;
      const nextStep = result ? step.next_on_success : step.next_on_failure;

      if (nextStep) {
        const stepIdx = steps.findIndex(s => s.id === nextStep);
        if (stepIdx >= 0) {
          await updateWorkflowRun(run.id, { current_step: stepIdx });
          const updatedRun = await getWorkflowRun(run.id);
          if (updatedRun) await executeStep(updatedRun);
          return;
        }
      }

      await advanceWorkflow(run.id);
      break;
    }
  }
}

// ── Workflow Lifecycle ──

export async function advanceWorkflow(workflowRunId: string): Promise<void> {
  const run = await getWorkflowRun(workflowRunId);
  if (!run) return;

  const nextStep = run.current_step + 1;
  await updateWorkflowRun(workflowRunId, {
    current_step: nextStep,
    waiting_for: null,
    wait_until: null,
    status: 'running',
  });

  const updatedRun = await getWorkflowRun(workflowRunId);
  if (updatedRun) await executeStep(updatedRun);
}

export async function resolveHumanAction(
  workflowRunId: string,
  actionData: Record<string, any>
): Promise<void> {
  const run = await getWorkflowRun(workflowRunId);
  if (!run || run.waiting_for !== 'human_action') {
    throw new Error('Workflow is not waiting for human action');
  }

  const currentState = JSON.parse(run.step_state);
  const newState = { ...currentState, ...actionData };

  await updateWorkflowRun(workflowRunId, { step_state: JSON.stringify(newState) });
  await advanceWorkflow(workflowRunId);
}

export async function completeWorkflow(workflowRunId: string): Promise<void> {
  await updateWorkflowRun(workflowRunId, { status: 'completed' });
  logger.info('Workflow completed', { workflowRunId });
}

export async function failWorkflow(workflowRunId: string, reason: string): Promise<void> {
  await updateWorkflowRun(workflowRunId, { status: 'failed' });
  logger.error('Workflow failed', { workflowRunId, reason });
}

async function updateWorkflowRun(id: string, updates: Partial<WorkflowRun>): Promise<void> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${paramIdx++}`);
    values.push(value);
  }

  fields.push(`updated_at = $${paramIdx++}`);
  values.push(new Date().toISOString());
  values.push(id);

  await query(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = $${paramIdx}`, values);
}

// ── Side Effects Idempotency ──

export async function recordSideEffect(
  workflowRunId: string,
  stepId: string,
  effectType: string,
  effectData: Record<string, any>,
  attemptNumber: number = 1
): Promise<boolean> {
  // Check if this side effect was already recorded
  const { rows: existing } = await query(
    'SELECT id FROM side_effects_log WHERE workflow_run_id = $1 AND step_id = $2 AND effect_type = $3',
    [workflowRunId, stepId, effectType]
  );

  if (existing.length > 0) {
    logger.info('Duplicate side effect skipped', { workflowRunId, stepId, effectType });
    return false;
  }

  await query(`
    INSERT INTO side_effects_log (id, workflow_run_id, step_id, attempt_number, effect_type, effect_data)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [uuid(), workflowRunId, stepId, attemptNumber, effectType, JSON.stringify(effectData)]);

  return true;
}

// ── Timer Recovery ──

export async function getExpiredTimers(): Promise<WorkflowRun[]> {
  const { rows } = await query(`
    SELECT * FROM workflow_runs
    WHERE status = 'waiting'
    AND waiting_for = 'timer'
    AND wait_until IS NOT NULL
    AND wait_until::timestamp <= NOW()
  `);
  return rows as WorkflowRun[];
}

export async function processExpiredTimers(): Promise<number> {
  const expired = await getExpiredTimers();
  for (const run of expired) {
    await advanceWorkflow(run.id);
  }
  return expired.length;
}
