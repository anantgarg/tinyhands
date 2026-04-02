import express from 'express';
import path from 'path';
import session from 'express-session';
import RedisStore from 'connect-redis';
import Redis from 'ioredis';
import { config } from './config';
import { getDefaultWorkspaceId } from './db';
import { createApiRouter } from './api';
import { deployWebhookHandler } from './modules/auto-update';
import { fireTrigger, getActiveTriggersByType } from './modules/triggers';
import { searchKB, listKBEntries, getCategories } from './modules/knowledge-base';
import { verifyLinearSignature, verifyZendeskSignature, verifyIntercomSignature } from './utils/webhooks';
import { logger } from './utils/logger';
import { v4 as uuid } from 'uuid';

export function createWebhookServer(): express.Application {
  const app = express();

  // Trust proxy (nginx terminates SSL)
  app.set('trust proxy', 1);

  // Raw body for signature verification (for webhooks)
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }));

  // URL-encoded form data support
  app.use(express.urlencoded({ extended: true }));

  // ── Session middleware (for web dashboard auth) ──
  const redisClient = new Redis(config.redis.url);
  app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: config.server.sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: 'auto',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax',
    },
  }));

  // ── Web Dashboard API ──
  app.use('/api/v1', createApiRouter());

  // ── Serve static files for web dashboard ──
  app.use(express.static(path.join(__dirname, '../dist/web')));

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

  // ── OAuth Callback ──
  app.get('/auth/callback/:integration', async (req, res) => {
    const { integration } = req.params;
    const { code, state } = req.query;

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    try {
      const { handleOAuthCallback } = await import('./modules/connections/oauth');
      const { userId, channelId } = await handleOAuthCallback(
        integration,
        code as string,
        state as string,
      );

      // Auto-register tools for this integration if they don't exist yet
      try {
        const { getIntegration: getManifest } = await import('./modules/tools/integrations');
        const manifest = getManifest(integration);
        if (manifest) {
          const wsId = (await import('./db')).getDefaultWorkspaceId();
          await manifest.register(wsId, userId, {});
        }
      } catch (regErr: any) {
        logger.error('Tool registration failed during OAuth callback', { integration, error: regErr.message });
      }

      // DM the user about successful connection + notify in channel
      try {
        const { sendDMBlocks, postMessage } = await import('./slack');
        await sendDMBlocks(userId, [
          { type: 'section', text: { type: 'mrkdwn', text: `:white_check_mark: Your *${integration}* account is now connected. You can use it with your agents.` } },
        ], `${integration} connected`);
        if (channelId) {
          await postMessage(channelId, `:white_check_mark: Successfully connected *${integration}*!`);
        }
      } catch { /* Slack notification is best-effort */ }

      // Check for pending retries waiting on this connection
      try {
        const { queryOne, execute: dbExecute } = await import('./db');
        const pendingRetry = await queryOne<{ id: string; data: any }>(
          `SELECT id, data FROM pending_confirmations
           WHERE data->>'type' = 'pending_connection_retry'
             AND data->>'userId' = $1
             AND data->>'integrationId' = $2
             AND expires_at > NOW()
           LIMIT 1`,
          [userId, integration],
        );
        if (pendingRetry) {
          const { enqueueRun } = await import('./queue');
          await enqueueRun(pendingRetry.data.jobData);
          await dbExecute('DELETE FROM pending_confirmations WHERE id = $1', [pendingRetry.id]);
          const { sendDMBlocks: dmBlocks } = await import('./slack');
          await dmBlocks(userId, [
            { type: 'section', text: { type: 'mrkdwn', text: `:arrows_counterclockwise: Got it! Retrying your previous request now.` } },
          ], 'Retrying request');
        }
      } catch { /* retry check is best-effort */ }

      res.status(200).send(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Connected!</h2>
          <p>Your ${integration} account has been connected successfully. You can close this window.</p>
        </body></html>
      `);
    } catch (err: any) {
      logger.error('OAuth callback failed', { integration, error: err.message });
      res.status(400).send(`
        <html><body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>Connection Failed</h2>
          <p>Something went wrong while connecting your account. Please close this window and try again.</p>
        </body></html>
      `);
    }
  });

  // ── Internal Approval API (used by runner containers for write policy enforcement) ──

  app.post('/internal/approval/request', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { agentId, agentName, toolName, details, userId, channelId, threadTs, writePolicy } = req.body;
    if (!agentId || !toolName || !channelId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    try {
      const requestId = uuid();
      const { setApprovalState } = await import('./queue');
      const ttl = writePolicy === 'confirm' ? 300 : undefined; // 5 min for user confirm, no TTL for admin
      await setApprovalState(requestId, 'pending', ttl);

      // Post approval message in Slack thread
      const { postBlocks: postApprovalBlocks } = await import('./slack');
      const isAdminConfirm = writePolicy === 'admin_confirm';
      const promptText = isAdminConfirm
        ? `:warning: *${agentName}* wants to perform a write action:\n\`${toolName}\`${details ? `\n${details}` : ''}\n\n_Waiting for owner approval..._`
        : `:warning: *${agentName}* wants to perform a write action:\n\`${toolName}\`${details ? `\n${details}` : ''}\n\n_Approve or deny to continue._`;

      await postApprovalBlocks(channelId, [
        { type: 'section', text: { type: 'mrkdwn', text: promptText } },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: ':white_check_mark: Approve' },
              style: 'primary',
              action_id: 'approve_write_action',
              value: JSON.stringify({ requestId, writePolicy, agentName, toolName }),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: ':x: Deny' },
              style: 'danger',
              action_id: 'deny_write_action',
              value: JSON.stringify({ requestId, writePolicy, agentName, toolName }),
            },
          ],
        },
      ], `Write approval: ${toolName}`, threadTs);

      res.json({ requestId });
    } catch (err: any) {
      logger.error('Approval request failed', { error: err.message });
      res.status(500).json({ error: 'Failed to create approval request' });
    }
  });

  app.get('/internal/approval/poll/:requestId', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const { getApprovalState } = await import('./queue');
      const state = await getApprovalState(req.params.requestId);
      res.json({ status: state || 'expired' });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to check approval state' });
    }
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

  // ── Internal Docs API (used by in-container docs tool) ──

  app.post('/internal/docs/create', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { createDocument } = await import('./modules/docs');
      const { markdownToSlateJson } = await import('./modules/docs/convert');
      const { type, title, description, content, agent_id, run_id, tags } = req.body;

      let docContent = content;
      if (type === 'doc' && typeof content === 'string') {
        docContent = markdownToSlateJson(content);
      }

      const doc = await createDocument(workspaceId, {
        type: type || 'doc',
        title: title || 'Untitled',
        description,
        content: docContent,
        tags,
        agentId: agent_id,
        runId: run_id,
        createdBy: agent_id || 'system',
        createdByType: 'agent',
      });
      res.json(doc);
    } catch (err: any) {
      logger.error('Internal docs create failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/internal/docs/get/:id', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, getSheetTabs } = await import('./modules/docs');
      const { slateJsonToMarkdown, cellDataToCsv } = await import('./modules/docs/convert');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

      const result: any = { id: doc.id, type: doc.type, title: doc.title, description: doc.description };

      if (doc.type === 'doc' && doc.content) {
        result.content = slateJsonToMarkdown(doc.content);
      } else if (doc.type === 'sheet') {
        const tabs = await getSheetTabs(workspaceId, doc.id);
        result.tabs = tabs.map(t => ({ id: t.id, name: t.name, csv: cellDataToCsv(t.data), row_count: t.row_count, col_count: t.col_count }));
      } else if (doc.type === 'file') {
        result.mime_type = doc.mime_type;
        result.file_size = doc.file_size;
        // For text-based files, include content
        if (doc.mime_type?.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml'].includes(doc.mime_type || '')) {
          const { getFile } = await import('./modules/docs/storage');
          const data = await getFile(doc.id);
          if (data) result.content = data.toString('utf-8').slice(0, 50000);
        }
      }
      res.json(result);
    } catch (err: any) {
      logger.error('Internal docs get failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/internal/docs/update/:id', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, updateDocument } = await import('./modules/docs');
      const { markdownToSlateJson } = await import('./modules/docs/convert');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
      if (!doc.agent_editable) { res.status(403).json({ error: 'Document is not agent-editable' }); return; }

      let content = req.body.content;
      if (doc.type === 'doc' && typeof content === 'string') {
        content = markdownToSlateJson(content);
      }

      const updated = await updateDocument(workspaceId, req.params.id, {
        title: req.body.title,
        content,
        updatedBy: req.body.agent_id || 'agent',
        expectedVersion: doc.version,
      });
      res.json(updated);
    } catch (err: any) {
      logger.error('Internal docs update failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/internal/docs/delete/:id', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { archiveDocument } = await import('./modules/docs');
      await archiveDocument(workspaceId, req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Internal docs delete failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/internal/docs/list', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { listDocuments } = await import('./modules/docs');
      const type = req.query.type as any;
      const agentId = req.query.agent_id as string;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await listDocuments(workspaceId, { type, agentId, limit });
      res.json({
        documents: result.documents.map(d => ({
          id: d.id, type: d.type, title: d.title, description: d.description,
          agent_id: d.agent_id, updated_at: d.updated_at,
        })),
        total: result.total,
      });
    } catch (err: any) {
      logger.error('Internal docs list failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/internal/docs/search', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { searchDocuments } = await import('./modules/docs');
      const results = await searchDocuments(workspaceId, req.body.query, req.body.limit || 10);
      res.json({
        results: results.map(d => ({
          id: d.id, type: d.type, title: d.title, description: d.description,
        })),
      });
    } catch (err: any) {
      logger.error('Internal docs search failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Sheet operations
  app.post('/internal/docs/sheet/:id/tab', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, createSheetTab } = await import('./modules/docs');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
      if (!doc.agent_editable) { res.status(403).json({ error: 'Document is not agent-editable' }); return; }
      const tab = await createSheetTab(workspaceId, req.params.id, req.body.name || 'New Sheet');
      res.json(tab);
    } catch (err: any) {
      logger.error('Internal sheet create tab failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/internal/docs/sheet/:id/tab/:tabId', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getSheetTabs } = await import('./modules/docs');
      const { cellDataToCsv } = await import('./modules/docs/convert');
      const tabs = await getSheetTabs(workspaceId, req.params.id);
      const tab = tabs.find(t => t.id === req.params.tabId);
      if (!tab) { res.status(404).json({ error: 'Tab not found' }); return; }
      res.json({ id: tab.id, name: tab.name, csv: cellDataToCsv(tab.data), row_count: tab.row_count, col_count: tab.col_count });
    } catch (err: any) {
      logger.error('Internal sheet read tab failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/internal/docs/sheet/:id/cells', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, updateCells } = await import('./modules/docs');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
      if (!doc.agent_editable) { res.status(403).json({ error: 'Document is not agent-editable' }); return; }

      const tab = await updateCells(workspaceId, req.body.tab_id, req.body.cells);
      res.json({ ok: true, row_count: tab.row_count, col_count: tab.col_count });
    } catch (err: any) {
      logger.error('Internal sheet update cells failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/internal/docs/sheet/:id/rows', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, appendRows } = await import('./modules/docs');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
      if (!doc.agent_editable) { res.status(403).json({ error: 'Document is not agent-editable' }); return; }

      const tab = await appendRows(workspaceId, req.body.tab_id, req.body.rows);
      res.json({ ok: true, row_count: tab.row_count, col_count: tab.col_count });
    } catch (err: any) {
      logger.error('Internal sheet append rows failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── SPA fallback — serve index.html for all non-API, non-webhook routes ──
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/webhooks/') ||
        req.path.startsWith('/internal/') || req.path.startsWith('/auth/') ||
        req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(__dirname, '../dist/web/index.html'), (err) => {
      if (err) next(); // File doesn't exist yet, fall through
    });
  });

  return app;
}

export function startWebhookServer(): import('http').Server {
  const app = createWebhookServer();
  const server = app.listen(config.server.port, () => {
    logger.info(`Webhook server listening on port ${config.server.port}`);
  });
  return server;
}
