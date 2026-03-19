import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { getRecentRuns, getRunRecord } from '../../modules/execution';
import { queryOne } from '../../db';
import { resolveUserNames } from '../helpers/user-resolver';
import type { RunRecord } from '../../types';
import { logger } from '../../utils/logger';

const router = Router();

// GET /runs — List recent runs with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getRecentRuns(workspaceId, limit);
    const userIds = (runs as any[]).map((r: any) => r.slack_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((runs as any[]).map((r: any) => ({
      ...r,
      displayName: names[r.slack_user_id] || r.slack_user_id,
    })));
  } catch (err: any) {
    logger.error('List runs error', { error: err.message });
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// GET /runs/trace/:traceId — Find run by trace ID (must be before /:id)
router.get('/trace/:traceId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const traceId = req.params.traceId as string;
    const run = await queryOne<RunRecord>(
      'SELECT * FROM run_history WHERE workspace_id = $1 AND trace_id = $2',
      [workspaceId, traceId],
    );
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (err: any) {
    logger.error('Get run by trace error', { error: err.message });
    res.status(500).json({ error: 'Failed to get run' });
  }
});

// GET /runs/:id — Run detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const run = await getRunRecord(workspaceId, id);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  } catch (err: any) {
    logger.error('Get run error', { error: err.message });
    res.status(500).json({ error: 'Failed to get run' });
  }
});

export default router;
