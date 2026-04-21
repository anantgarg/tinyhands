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

let sessionRedisClient: import('ioredis').default | null = null;

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
  sessionRedisClient = new Redis(config.redis.url);
  const redisClient = sessionRedisClient;
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

  // ── Generic Agent Webhook Triggers (workspace-scoped) ──
  // New URL: /webhooks/w/:workspaceSlug/agent/:agentSlug
  // Legacy URL: /webhooks/agent-:agentName — returns 301 to new URL if we can
  // resolve it to a single workspace, 404 otherwise.
  app.post('/webhooks/w/:workspaceSlug/agent/:agentSlug', async (req, res) => {
    const { workspaceSlug, agentSlug } = req.params;
    const { queryOne } = await import('./db');
    const ws = await queryOne<{ id: string }>(
      'SELECT id FROM workspaces WHERE workspace_slug = $1 AND status = $2',
      [workspaceSlug, 'active'],
    );
    if (!ws) {
      res.status(404).json({ error: 'Unknown workspace' });
      return;
    }

    const webhookTriggers = await getActiveTriggersByType(ws.id, 'webhook');
    const matching = webhookTriggers.filter((t) => {
      const cfg = JSON.parse(t.config_json);
      return cfg.agent_slug === agentSlug || cfg.agent_name === agentSlug;
    });

    if (matching.length === 0) {
      res.status(404).json({ error: 'No active webhook trigger found for this agent' });
      return;
    }

    for (const trigger of matching) {
      const idempotencyKey = `webhook:${agentSlug}:${req.body?.id || uuid()}`;
      await fireTrigger(trigger.workspace_id, {
        triggerId: trigger.id,
        idempotencyKey,
        payload: req.body,
      });
    }

    res.status(202).json({ message: 'Trigger fired', count: matching.length });
  });

  // Legacy global webhook endpoint — redirect (if unambiguous) or accept on the
  // default workspace for backwards compatibility during migration.
  app.post('/webhooks/agent-:agentName', async (req, res) => {
    const { agentName } = req.params;
    const { query: dbQuery, getDefaultWorkspaceIdOrNull } = await import('./db');
    const matchingWs = await dbQuery<{ workspace_slug: string }>(
      `SELECT DISTINCT w.workspace_slug
         FROM triggers t
         JOIN workspaces w ON w.id = t.workspace_id
        WHERE t.type = 'webhook' AND t.active = TRUE AND w.status = 'active'
          AND (t.config_json::jsonb ->> 'agent_name' = $1 OR t.config_json::jsonb ->> 'agent_slug' = $1)`,
      [agentName],
    );

    if (matchingWs.length === 1) {
      res.redirect(301, `/webhooks/w/${matchingWs[0].workspace_slug}/agent/${agentName}`);
      return;
    }

    // Fall back to default workspace if set (self-hosted compatibility)
    const defaultWs = getDefaultWorkspaceIdOrNull();
    if (!defaultWs) {
      res.status(404).json({ error: 'No workspace context — use /webhooks/w/{workspaceSlug}/agent/{agentSlug}' });
      return;
    }

    const webhookTriggers = await getActiveTriggersByType(defaultWs, 'webhook');
    const matching = webhookTriggers.filter((t) => {
      const cfg = JSON.parse(t.config_json);
      return cfg.agent_name === agentName || cfg.agent_slug === agentName;
    });
    if (matching.length === 0) {
      res.status(404).json({ error: 'No active webhook trigger found for this agent' });
      return;
    }
    for (const trigger of matching) {
      const idempotencyKey = `webhook:${agentName}:${req.body?.id || uuid()}`;
      await fireTrigger(trigger.workspace_id, { triggerId: trigger.id, idempotencyKey, payload: req.body });
    }
    res.status(202).json({ message: 'Trigger fired', count: matching.length });
  });

  // Generic helper: run a signed webhook against every workspace that has an
  // active trigger of the given type. Each trigger's config may carry its own
  // signing secret; fall back to the global env-level secret if none.
  // If a global env secret is configured, the signature must verify against it
  // or we return 401 immediately — that's the legacy single-tenant contract.
  async function dispatchSignedWebhook(opts: {
    req: any;
    res: express.Response;
    type: 'linear' | 'zendesk' | 'intercom';
    signatureHeader: string;
    envSecret: string;
    verify: (body: string, sig: string, secret: string) => boolean;
    idempotencyKeyFor: (body: any) => string;
  }): Promise<void> {
    const { req, res, type, signatureHeader, envSecret, verify, idempotencyKeyFor } = opts;
    const signature = req.headers[signatureHeader] as string;

    if (envSecret && !verify(req.rawBody || '', signature, envSecret)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const { listActiveWorkspaces } = await import('./db');
    const workspaces = await listActiveWorkspaces();

    let totalTriggers = 0;
    for (const ws of workspaces) {
      const triggers = await getActiveTriggersByType(ws.id, type);
      for (const trigger of triggers) {
        const cfg = JSON.parse(trigger.config_json || '{}') as Record<string, string | undefined>;
        // Per-trigger secret override: if set, must verify against the payload
        if (cfg.webhook_secret && signature && !verify(req.rawBody || '', signature, cfg.webhook_secret)) {
          continue;
        }
        const idempotencyKey = idempotencyKeyFor(req.body);
        await fireTrigger(trigger.workspace_id, { triggerId: trigger.id, idempotencyKey, payload: req.body });
        totalTriggers++;
      }
    }

    if (totalTriggers === 0) {
      res.status(200).json({ message: `No active ${type.charAt(0).toUpperCase() + type.slice(1)} triggers` });
      return;
    }
    res.status(200).json({ message: 'OK' });
  }

  app.post('/webhooks/linear', async (req: any, res) => {
    await dispatchSignedWebhook({
      req, res, type: 'linear',
      signatureHeader: 'linear-signature',
      envSecret: process.env.LINEAR_WEBHOOK_SECRET || '',
      verify: verifyLinearSignature,
      idempotencyKeyFor: (b) => `linear:${b.action}:${b.data?.id || uuid()}`,
    });
  });

  app.post('/webhooks/zendesk', async (req: any, res) => {
    await dispatchSignedWebhook({
      req, res, type: 'zendesk',
      signatureHeader: 'x-zendesk-webhook-signature',
      envSecret: process.env.ZENDESK_WEBHOOK_SECRET || '',
      verify: verifyZendeskSignature,
      idempotencyKeyFor: (b) => `zendesk:${b.ticket_id || uuid()}:${b.updated_at || ''}`,
    });
  });

  app.post('/webhooks/intercom', async (req: any, res) => {
    await dispatchSignedWebhook({
      req, res, type: 'intercom',
      signatureHeader: 'x-hub-signature',
      envSecret: process.env.INTERCOM_WEBHOOK_SECRET || '',
      verify: verifyIntercomSignature,
      idempotencyKeyFor: (b) => `intercom:${b.id || uuid()}`,
    });
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

      // Deliberately no Slack notification here — the browser success page
      // already confirms the connection, and an unsolicited DM after a
      // dashboard action feels off. (Slack-initiated connect flows can show
      // their own in-channel confirmation if/when that's wired back in.)

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

    const { workspaceId, agentId, agentName, toolName, details, userId, channelId, threadTs, writePolicy } = req.body;
    if (!agentId || !toolName || !channelId || !workspaceId) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    try {
      const requestId = uuid();
      const { setApprovalState } = await import('./queue');
      const ttl = writePolicy === 'confirm' ? 300 : undefined; // 5 min for user confirm, no TTL for admin
      await setApprovalState(workspaceId, requestId, 'pending', ttl);

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
              value: JSON.stringify({ workspaceId, requestId, writePolicy, agentName, toolName }),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: ':x: Deny' },
              style: 'danger',
              action_id: 'deny_write_action',
              value: JSON.stringify({ workspaceId, requestId, writePolicy, agentName, toolName }),
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

    const workspaceId = (req.query.workspaceId as string) || '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspaceId query param required' });
      return;
    }

    try {
      const { getApprovalState } = await import('./queue');
      const state = await getApprovalState(workspaceId, req.params.requestId);
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

  // Internal wiki ops — used by the kb / docs tools inside agent containers.
  // Workspace is resolved from the X-Workspace-Id header (set by the runner)
  // with the bootstrap default as a fallback for self-hosted single-tenant setups.
  function resolveInternalWorkspace(req: any): string {
    return (req.headers['x-workspace-id'] as string) || getDefaultWorkspaceId();
  }

  app.get('/internal/wiki/list', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const workspaceId = resolveInternalWorkspace(req);
      const namespace = (req.query.namespace === 'docs' ? 'docs' : 'kb') as 'kb' | 'docs';
      const { listPages } = await import('./modules/kb-wiki');
      const pages = await listPages(workspaceId, namespace);
      res.json({
        namespace,
        pages: pages.map(p => ({ path: p.path, title: p.title, kind: p.kind })),
      });
    } catch (err: any) {
      logger.error('Internal wiki list failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/internal/wiki/page', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const workspaceId = resolveInternalWorkspace(req);
      const namespace = (req.query.namespace === 'docs' ? 'docs' : 'kb') as 'kb' | 'docs';
      const path = String(req.query.path || '');
      if (!path) { res.status(400).json({ error: 'path required' }); return; }
      const { getPage } = await import('./modules/kb-wiki');
      const page = await getPage(workspaceId, namespace, path);
      if (!page) { res.status(404).json({ error: 'page not found' }); return; }
      res.json({ path: page.path, title: page.title, kind: page.kind, content: page.content });
    } catch (err: any) {
      logger.error('Internal wiki read failed', { error: err.message });
      res.status(500).json({ error: err.message });
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

      const result: any = { id: doc.id, type: doc.type, title: doc.title, description: doc.description, version: doc.version };

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

      const expectedVersion = req.body.expected_version ?? doc.version;

      const updated = await updateDocument(workspaceId, req.params.id, {
        title: req.body.title,
        content,
        updatedBy: req.body.agent_id || 'agent',
        expectedVersion,
      });
      res.json(updated);
    } catch (err: any) {
      if (err.message === 'VERSION_CONFLICT') {
        res.status(409).json({ error: 'Document was modified concurrently. Re-read the document and try again.', currentVersion: err.currentVersion });
      } else {
        logger.error('Internal docs update failed', { error: err.message });
        res.status(500).json({ error: err.message });
      }
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

  app.delete('/internal/docs/sheet/:id/tab/:tabId', async (req, res) => {
    const secret = req.headers['x-internal-secret'] as string;
    if (config.server.internalSecret && secret !== config.server.internalSecret) {
      res.status(401).json({ error: 'Unauthorized' }); return;
    }
    try {
      const workspaceId = getDefaultWorkspaceId();
      const { getDocument, deleteSheetTab } = await import('./modules/docs');
      const doc = await getDocument(workspaceId, req.params.id);
      if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
      if (!doc.agent_editable) { res.status(403).json({ error: 'Document is not agent-editable' }); return; }
      await deleteSheetTab(workspaceId, req.params.tabId);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Internal sheet delete tab failed', { error: err.message });
      res.status(err.message === 'Cannot delete the last tab in a sheet' ? 400 : 500).json({ error: err.message });
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

      const cells = req.body.cells;
      if (cells && typeof cells === 'object' && Object.keys(cells).length > 10000) {
        res.status(400).json({ error: 'Too many cells in a single update (max 10,000)' }); return;
      }
      const cellsPayloadSize = Buffer.byteLength(JSON.stringify(cells), 'utf-8');
      if (cellsPayloadSize > 10 * 1024 * 1024) {
        res.status(400).json({ error: 'Cell data too large (max 10 MB)' }); return;
      }

      const tab = await updateCells(workspaceId, req.body.tab_id, cells);
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

export async function closeSessionRedis(): Promise<void> {
  if (sessionRedisClient) {
    await sessionRedisClient.quit();
    sessionRedisClient = null;
  }
}
