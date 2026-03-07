import express from 'express';
import { config } from './config';
import { deployWebhookHandler } from './modules/auto-update';
import { fireTrigger, getActiveTriggersByType } from './modules/triggers';
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

    const webhookTriggers = getActiveTriggersByType('webhook');
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
      await fireTrigger({
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

    const triggers = getActiveTriggersByType('linear');
    if (triggers.length === 0) {
      res.status(200).json({ message: 'No active Linear triggers' });
      return;
    }

    for (const trigger of triggers) {
      const idempotencyKey = `linear:${req.body.action}:${req.body.data?.id || uuid()}`;
      await fireTrigger({
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

    const triggers = getActiveTriggersByType('zendesk');
    for (const trigger of triggers) {
      const idempotencyKey = `zendesk:${req.body.ticket_id || uuid()}:${req.body.updated_at || ''}`;
      await fireTrigger({
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

    const triggers = getActiveTriggersByType('intercom');
    for (const trigger of triggers) {
      const idempotencyKey = `intercom:${req.body.id || uuid()}`;
      await fireTrigger({
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }
    res.status(200).json({ message: 'OK' });
  });

  return app;
}

export function startWebhookServer(): void {
  const app = createWebhookServer();
  app.listen(config.server.port, () => {
    logger.info(`Webhook server listening on port ${config.server.port}`);
  });
}
