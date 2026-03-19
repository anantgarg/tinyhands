import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAlertRules, checkAlerts, getAgentErrorRates } from '../../modules/observability';
import { logger } from '../../utils/logger';

const router = Router();

// GET /observability/alert-rules — List alert rules
router.get('/alert-rules', (_req: Request, res: Response) => {
  try {
    const rules = getAlertRules();
    res.json(rules);
  } catch (err: any) {
    logger.error('List alert rules error', { error: err.message });
    res.status(500).json({ error: 'Failed to list alert rules' });
  }
});

// GET /observability/alerts — Check current alerts
router.get('/alerts', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const alerts = await checkAlerts(workspaceId);
    res.json(alerts);
  } catch (err: any) {
    logger.error('Check alerts error', { error: err.message });
    res.status(500).json({ error: 'Failed to check alerts' });
  }
});

// GET /observability/error-rates — Get per-agent error rates
router.get('/error-rates', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const rates = await getAgentErrorRates(workspaceId);
    res.json(rates);
  } catch (err: any) {
    logger.error('Get error rates error', { error: err.message });
    res.status(500).json({ error: 'Failed to get error rates' });
  }
});

export default router;
