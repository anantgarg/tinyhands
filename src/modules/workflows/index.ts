import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
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

export function createWorkflowDefinition(
  name: string,
  agentId: string,
  steps: WorkflowStep[],
  createdBy: string
): WorkflowDefinition {
  const db = getDb();
  const id = uuid();

  const definition: WorkflowDefinition = {
    id,
    name,
    agent_id: agentId,
    steps_json: JSON.stringify(steps),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO workflow_definitions (id, name, agent_id, steps_json, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(definition.id, definition.name, definition.agent_id,
    definition.steps_json, definition.created_by, definition.created_at);

  logger.info('Workflow definition created', { workflowId: id, name, agentId });
  return definition;
}

export function getWorkflowDefinition(id: string): WorkflowDefinition | null {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_definitions WHERE id = ?').get(id) as WorkflowDefinition | null;
}

// ── Workflow Execution ──

export function startWorkflow(workflowId: string): WorkflowRun {
  const db = getDb();
  const definition = getWorkflowDefinition(workflowId);
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

  db.prepare(`
    INSERT INTO workflow_runs (id, workflow_id, run_id, current_step, step_state,
      waiting_for, wait_until, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(run.id, run.workflow_id, run.run_id, run.current_step,
    run.step_state, run.waiting_for, run.wait_until, run.status,
    run.created_at, run.updated_at);

  logger.info('Workflow started', { workflowRunId: id, workflowId });

  // Execute first step
  executeStep(run);

  return run;
}

export function getWorkflowRun(id: string): WorkflowRun | null {
  const db = getDb();
  return db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as WorkflowRun | null;
}

export function getActiveWorkflowRuns(): WorkflowRun[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM workflow_runs WHERE status IN (?, ?)'
  ).all('running', 'waiting') as WorkflowRun[];
}

export async function executeStep(run: WorkflowRun): Promise<void> {
  const definition = getWorkflowDefinition(run.workflow_id);
  if (!definition) throw new Error(`Workflow ${run.workflow_id} not found`);

  const steps: WorkflowStep[] = JSON.parse(definition.steps_json);

  if (run.current_step >= steps.length) {
    completeWorkflow(run.id);
    return;
  }

  if (run.current_step >= MAX_WORKFLOW_STEPS) {
    failWorkflow(run.id, 'Max step count exceeded');
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

      updateWorkflowRun(run.id, {
        waiting_for: 'timer',
        wait_until: waitUntil,
        status: 'waiting',
      });
      break;
    }

    case 'human_action': {
      updateWorkflowRun(run.id, {
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
          updateWorkflowRun(run.id, { current_step: stepIdx });
          const updatedRun = getWorkflowRun(run.id)!;
          await executeStep(updatedRun);
          return;
        }
      }

      advanceWorkflow(run.id);
      break;
    }
  }
}

// ── Workflow Lifecycle ──

export function advanceWorkflow(workflowRunId: string): void {
  const db = getDb();
  const run = getWorkflowRun(workflowRunId);
  if (!run) return;

  const nextStep = run.current_step + 1;
  updateWorkflowRun(workflowRunId, {
    current_step: nextStep,
    waiting_for: null,
    wait_until: null,
    status: 'running',
  });

  const updatedRun = getWorkflowRun(workflowRunId)!;
  executeStep(updatedRun);
}

export function resolveHumanAction(
  workflowRunId: string,
  actionData: Record<string, any>
): void {
  const run = getWorkflowRun(workflowRunId);
  if (!run || run.waiting_for !== 'human_action') {
    throw new Error('Workflow is not waiting for human action');
  }

  const currentState = JSON.parse(run.step_state);
  const newState = { ...currentState, ...actionData };

  updateWorkflowRun(workflowRunId, { step_state: JSON.stringify(newState) });
  advanceWorkflow(workflowRunId);
}

export function completeWorkflow(workflowRunId: string): void {
  updateWorkflowRun(workflowRunId, { status: 'completed' });
  logger.info('Workflow completed', { workflowRunId });
}

export function failWorkflow(workflowRunId: string, reason: string): void {
  updateWorkflowRun(workflowRunId, { status: 'failed' });
  logger.error('Workflow failed', { workflowRunId, reason });
}

function updateWorkflowRun(id: string, updates: Partial<WorkflowRun>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  db.prepare(`UPDATE workflow_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ── Side Effects Idempotency ──

export function recordSideEffect(
  workflowRunId: string,
  stepId: string,
  effectType: string,
  effectData: Record<string, any>,
  attemptNumber: number = 1
): boolean {
  const db = getDb();

  // Check if this side effect was already recorded
  const existing = db.prepare(
    'SELECT id FROM side_effects_log WHERE workflow_run_id = ? AND step_id = ? AND effect_type = ?'
  ).get(workflowRunId, stepId, effectType);

  if (existing) {
    logger.info('Duplicate side effect skipped', { workflowRunId, stepId, effectType });
    return false;
  }

  db.prepare(`
    INSERT INTO side_effects_log (id, workflow_run_id, step_id, attempt_number, effect_type, effect_data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), workflowRunId, stepId, attemptNumber, effectType, JSON.stringify(effectData));

  return true;
}

// ── Timer Recovery ──

export function getExpiredTimers(): WorkflowRun[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM workflow_runs
    WHERE status = 'waiting'
    AND waiting_for = 'timer'
    AND wait_until IS NOT NULL
    AND datetime(wait_until) <= datetime('now')
  `).all() as WorkflowRun[];
}

export function processExpiredTimers(): number {
  const expired = getExpiredTimers();
  for (const run of expired) {
    advanceWorkflow(run.id);
  }
  return expired.length;
}
