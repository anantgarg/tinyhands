import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  createWorkflowDefinition, getWorkflowDefinition,
  startWorkflow, getWorkflowRun, resolveHumanAction,
} from '../../modules/workflows';
import { query } from '../../db';
import type { WorkflowDefinition, WorkflowRun } from '../../types';
import { logger } from '../../utils/logger';

const router = Router();

// GET /workflows/definitions — List workflow definitions
router.get('/definitions', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const definitions = await query<WorkflowDefinition>(
      'SELECT * FROM workflow_definitions WHERE workspace_id = $1 ORDER BY created_at DESC',
      [workspaceId],
    );
    res.json(definitions);
  } catch (err: any) {
    logger.error('List workflow definitions error', { error: err.message });
    res.status(500).json({ error: 'Failed to list workflow definitions' });
  }
});

// GET /workflows/definitions/:id — Get workflow definition
router.get('/definitions/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const definition = await getWorkflowDefinition(workspaceId, id);
    if (!definition) {
      res.status(404).json({ error: 'Workflow definition not found' });
      return;
    }
    res.json(definition);
  } catch (err: any) {
    logger.error('Get workflow definition error', { error: err.message });
    res.status(500).json({ error: 'Failed to get workflow definition' });
  }
});

// POST /workflows/definitions — Create workflow definition
router.post('/definitions', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { name, agentId, steps } = req.body;
    if (!name || !agentId || !steps) {
      res.status(400).json({ error: 'name, agentId, and steps are required' });
      return;
    }
    const definition = await createWorkflowDefinition(workspaceId, name, agentId, steps, userId);
    res.status(201).json(definition);
  } catch (err: any) {
    logger.error('Create workflow definition error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t create the workflow. Please try again." });
  }
});

// GET /workflows/runs — List workflow runs
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await query<WorkflowRun>(
      'SELECT * FROM workflow_runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2',
      [workspaceId, limit],
    );
    res.json(runs);
  } catch (err: any) {
    logger.error('List workflow runs error', { error: err.message });
    res.status(500).json({ error: 'Failed to list workflow runs' });
  }
});

// GET /workflows/runs/:id — Get workflow run
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const run = await getWorkflowRun(workspaceId, id);
    if (!run) {
      res.status(404).json({ error: 'Workflow run not found' });
      return;
    }
    res.json(run);
  } catch (err: any) {
    logger.error('Get workflow run error', { error: err.message });
    res.status(500).json({ error: 'Failed to get workflow run' });
  }
});

// POST /workflows/definitions/:id/start — Start a workflow
router.post('/definitions/:id/start', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const run = await startWorkflow(workspaceId, id);
    res.status(201).json(run);
  } catch (err: any) {
    logger.error('Start workflow error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t start the workflow. Please try again." });
  }
});

// POST /workflows/runs/:id/resolve — Resolve human action
router.post('/runs/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { actionData } = req.body;
    if (!actionData) {
      res.status(400).json({ error: 'actionData is required' });
      return;
    }
    await resolveHumanAction(workspaceId, id, actionData);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Resolve human action error', { error: err.message });
    res.status(400).json({ error: "Couldn\'t complete the action. Please try again." });
  }
});

export default router;
