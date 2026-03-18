import express from 'express';
import { config } from './config';
import { getDefaultWorkspaceId } from './db';
import { deployWebhookHandler } from './modules/auto-update';
import { fireTrigger, getActiveTriggersByType } from './modules/triggers';
import { searchKB, listKBEntries, getCategories } from './modules/knowledge-base';
import { verifyLinearSignature, verifyZendeskSignature, verifyIntercomSignature } from './utils/webhooks';
import { logger } from './utils/logger';
import { v4 as uuid } from 'uuid';

export function createWebhookServer(): express.Application {
  const app = express();

  // Raw body for signature verification
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ── GitHub Deploy Webhook ──
  app.post('/webhooks/github-deploy', deployWebhookHandler);

  // ── Generic Agent Webhook Triggers ──
  app.post('/webhooks/agent-:agentName', async (req, res) => {
    const { agentName } = req.params;
    const workspaceId = getDefaultWorkspaceId();

    const webhookTriggers = await getActiveTriggersByType(workspaceId, 'webhook');
    const matching = webhookTriggers.filter(t => {
      const cfg = JSON.parse(t.config_json);
      return cfg.agent_name === agentName;
    });

    if (matching.length === 0) {
      res.status(404).json({ error: 'No active webhook trigger found for this agent' });
      return;
    }

    for (const trigger of matching) {
      const idempotencyKey = `webhook:${agentName}:${req.body.id || uuid()}`;
      await fireTrigger(trigger.workspace_id, {
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }

    res.status(202).json({ message: 'Trigger fired', count: matching.length });
  });

  // ── Linear Webhook (with signature verification) ──
  app.post('/webhooks/linear', async (req: any, res) => {
    const signature = req.headers['linear-signature'] as string;
    const secret = process.env.LINEAR_WEBHOOK_SECRET || '';

    if (secret && !verifyLinearSignature(req.rawBody || '', signature, secret)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const workspaceId = getDefaultWorkspaceId();
    const triggers = await getActiveTriggersByType(workspaceId, 'linear');
    if (triggers.length === 0) {
      res.status(200).json({ message: 'No active Linear triggers' });
      return;
    }

    for (const trigger of triggers) {
      const idempotencyKey = `linear:${req.body.action}:${req.body.data?.id || uuid()}`;
      await fireTrigger(trigger.workspace_id, {
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }

    res.status(200).json({ message: 'OK' });
  });

  // ── Zendesk Webhook (with signature verification) ──
  app.post('/webhooks/zendesk', async (req: any, res) => {
    const signature = req.headers['x-zendesk-webhook-signature'] as string;
    const secret = process.env.ZENDESK_WEBHOOK_SECRET || '';

    if (secret && !verifyZendeskSignature(req.rawBody || '', signature, secret)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const workspaceId = getDefaultWorkspaceId();
    const triggers = await getActiveTriggersByType(workspaceId, 'zendesk');
    for (const trigger of triggers) {
      const idempotencyKey = `zendesk:${req.body.ticket_id || uuid()}:${req.body.updated_at || ''}`;
      await fireTrigger(trigger.workspace_id, {
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }
    res.status(200).json({ message: 'OK' });
  });

  // ── Intercom Webhook (with signature verification) ──
  app.post('/webhooks/intercom', async (req: any, res) => {
    const signature = req.headers['x-hub-signature'] as string;
    const secret = process.env.INTERCOM_WEBHOOK_SECRET || '';

    if (secret && !verifyIntercomSignature(req.rawBody || '', signature, secret)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const workspaceId = getDefaultWorkspaceId();
    const triggers = await getActiveTriggersByType(workspaceId, 'intercom');
    for (const trigger of triggers) {
      const idempotencyKey = `intercom:${req.body.id || uuid()}`;
      await fireTrigger(trigger.workspace_id, {
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }
    res.status(200).json({ message: 'OK' });
  });

  // ── Internal KB API (used by in-container kb-search tool) ──

  app.post('/internal/kb/search', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { query: q, agent_id, limit } = req.body;
    if (!q) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const workspaceId = getDefaultWorkspaceId();
      const results = await searchKB(workspaceId, q, agent_id, limit || 4000);
      res.json({
        results: results.map(e => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          content: e.content.slice(0, 3000),
          category: e.category,
          tags: e.tags,
        })),
      });
    } catch (err: any) {
      logger.error('Internal KB search failed', { error: err.message });
      res.status(500).json({ error: 'Search failed' });
    }
  });

  app.get('/internal/kb/list', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as string;

    try {
      const workspaceId = getDefaultWorkspaceId();
      let entries = await listKBEntries(workspaceId, limit);
      if (category) {
        entries = entries.filter(e => e.category === category);
      }
      res.json({
        entries: entries.map(e => ({
          id: e.id,
          title: e.title,
          summary: e.summary,
          category: e.category,
          tags: e.tags,
        })),
      });
    } catch (err: any) {
      logger.error('Internal KB list failed', { error: err.message });
      res.status(500).json({ error: 'List failed' });
    }
  });

  app.get('/internal/kb/categories', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const workspaceId = getDefaultWorkspaceId();
      const categories = await getCategories(workspaceId);
      res.json({ categories });
    } catch (err: any) {
      logger.error('Internal KB categories failed', { error: err.message });
      res.status(500).json({ error: 'Categories failed' });
    }
  });

  return app;
}

export function startWebhookServer(): void {
  const app = createWebhookServer();
  app.listen(config.server.port, () => {
    logger.info(`Webhook server listening on port ${config.server.port}`);
  });
}
