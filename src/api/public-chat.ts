import type { Application, Request, Response } from 'express';
import { logger } from '../utils/logger';

// ── Public Web Chat routes ──
// Visitors reach an agent at /chat/:token with no Slack or dashboard account.
// A username/password gate issues a signed, httpOnly, per-token cookie; every
// subsequent request is checked against it. Agent runs are enqueued with no
// Slack channel and the reply is polled back from run_history by trace_id.

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function registerPublicChatRoutes(app: Application): void {
  // GET /api/public/chat/:token — public metadata so the page can render a title
  app.get('/api/public/chat/:token', async (req, res) => {
    try {
      const { getWebChatByToken } = await import('../modules/web-chat');
      const { queryOne } = await import('../db');
      const channel = await getWebChatByToken(req.params.token);
      if (!channel || !channel.enabled) {
        res.status(404).json({ error: 'This chat link is not available.' });
        return;
      }
      const agent = await queryOne<{ name: string; avatar_emoji: string }>(
        'SELECT name, avatar_emoji FROM agents WHERE id = $1',
        [channel.agent_id],
      );
      res.json({
        name: channel.name,
        agentName: agent?.name ?? 'Assistant',
        agentEmoji: agent?.avatar_emoji ?? '',
      });
    } catch (err: any) {
      logger.error('Web chat metadata error', { error: err.message });
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /api/public/chat/:token/login — verify the shared credential
  app.post('/api/public/chat/:token/login', async (req, res) => {
    try {
      const { verifyWebChatCredential, signChatSession, chatCookieName } = await import('../modules/web-chat');
      const username = String(req.body?.username ?? '');
      const password = String(req.body?.password ?? '');
      const channel = await verifyWebChatCredential(req.params.token, username, password);
      if (!channel) {
        res.status(401).json({ error: 'Incorrect username or password.' });
        return;
      }
      res.cookie(chatCookieName(channel.public_token), signChatSession(channel.public_token), {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'lax',
        maxAge: 12 * 60 * 60 * 1000,
        path: '/',
      });
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Web chat login error', { error: err.message });
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // Shared gate: returns the channel if the request carries a valid session
  // cookie for an enabled web chat, otherwise writes a 401/404 and returns null.
  async function authPublicChat(req: Request, res: Response) {
    const { getWebChatByToken, verifyChatSession, chatCookieName } = await import('../modules/web-chat');
    const token = req.params.token as string;
    const channel = await getWebChatByToken(token);
    if (!channel || !channel.enabled) {
      res.status(404).json({ error: 'This chat link is not available.' });
      return null;
    }
    const cookies = parseCookieHeader(req.headers.cookie);
    if (!verifyChatSession(cookies[chatCookieName(token)], token)) {
      res.status(401).json({ error: 'Please sign in to continue.' });
      return null;
    }
    return channel;
  }

  // POST /api/public/chat/:token/message — enqueue a visitor message
  app.post('/api/public/chat/:token/message', async (req, res) => {
    try {
      const channel = await authPublicChat(req, res);
      if (!channel) return;

      const text = String(req.body?.text ?? '').trim();
      if (!text) {
        res.status(400).json({ error: 'Message cannot be empty.' });
        return;
      }

      const { createSession, sessionBelongsToChannel, dispatchWebChatMessage } = await import('../modules/web-chat');
      const { checkRateLimit } = await import('../queue');

      const rate = await checkRateLimit(channel.workspace_id);
      if (!rate.allowed) {
        res.status(429).json({ error: 'The assistant is busy right now — please try again in a moment.' });
        return;
      }

      let sessionId = req.body?.sessionId ? String(req.body.sessionId) : '';
      if (sessionId) {
        if (!(await sessionBelongsToChannel(sessionId, channel.id))) {
          res.status(400).json({ error: 'Unknown conversation.' });
          return;
        }
      } else {
        sessionId = await createSession(channel.id);
      }

      const { traceId } = await dispatchWebChatMessage(channel, sessionId, text);
      res.json({ sessionId, traceId });
    } catch (err: any) {
      logger.error('Web chat message error', { error: err.message });
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // GET /api/public/chat/:token/message/:traceId — poll for the agent's reply
  app.get('/api/public/chat/:token/message/:traceId', async (req, res) => {
    try {
      const channel = await authPublicChat(req, res);
      if (!channel) return;

      const sessionId = req.query.sessionId ? String(req.query.sessionId) : '';
      const traceId = req.params.traceId as string;
      const { queryOne } = await import('../db');
      const run = await queryOne<{ status: string; output: string }>(
        'SELECT status, output FROM run_history WHERE workspace_id = $1 AND trace_id = $2',
        [channel.workspace_id, traceId],
      );
      if (!run) {
        res.json({ status: 'running' });
        return;
      }
      if (run.status === 'completed') {
        // Record the assistant turn exactly once so history stays consistent.
        if (sessionId) {
          const { sessionBelongsToChannel, hasAssistantMessage, appendMessage } = await import('../modules/web-chat');
          if (
            (await sessionBelongsToChannel(sessionId, channel.id)) &&
            !(await hasAssistantMessage(sessionId, traceId))
          ) {
            await appendMessage(sessionId, 'assistant', run.output || '', traceId);
          }
        }
        res.json({ status: 'done', content: run.output || '' });
        return;
      }
      if (run.status === 'failed' || run.status === 'timeout') {
        res.json({ status: 'error' });
        return;
      }
      res.json({ status: 'running' });
    } catch (err: any) {
      logger.error('Web chat poll error', { error: err.message });
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });
}
