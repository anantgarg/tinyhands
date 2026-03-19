import { Router } from 'express';
import { requireAuth } from './middleware/auth';
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import agentRoutes from './routes/agents';
import runRoutes from './routes/runs';
import templateRoutes from './routes/templates';
import toolRoutes from './routes/tools';
import kbRoutes from './routes/kb';
import connectionRoutes from './routes/connections';
import triggerRoutes from './routes/triggers';
import workflowRoutes from './routes/workflows';
import evolutionRoutes from './routes/evolution';
import observabilityRoutes from './routes/observability';
import accessRoutes from './routes/access-control';
import auditRoutes from './routes/audit';
import settingsRoutes from './routes/settings';
import skillRoutes from './routes/skills';
import slackHelperRoutes from './routes/slack-helpers';
import chatRoutes from './routes/chat';

export function createApiRouter(): Router {
  const router = Router();

  // Auth routes (no auth middleware needed for login/callback)
  router.use('/auth', authRoutes);

  // All other routes require authentication
  router.use('/dashboard', requireAuth, dashboardRoutes);
  router.use('/agents', requireAuth, agentRoutes);
  router.use('/runs', requireAuth, runRoutes);
  router.use('/templates', requireAuth, templateRoutes);
  router.use('/tools', requireAuth, toolRoutes);
  router.use('/kb', requireAuth, kbRoutes);
  router.use('/connections', requireAuth, connectionRoutes);
  router.use('/triggers', requireAuth, triggerRoutes);
  router.use('/workflows', requireAuth, workflowRoutes);
  router.use('/evolution', requireAuth, evolutionRoutes);
  router.use('/observability', requireAuth, observabilityRoutes);
  router.use('/access', requireAuth, accessRoutes);
  router.use('/audit', requireAuth, auditRoutes);
  router.use('/settings', requireAuth, settingsRoutes);
  router.use('/skills', requireAuth, skillRoutes);
  router.use('/slack', requireAuth, slackHelperRoutes);
  router.use('/chat', requireAuth, chatRoutes);

  // Catch-all 404 for API routes (return JSON, not HTML)
  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return router;
}
