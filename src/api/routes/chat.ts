import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { streamChat, chatSync } from '../../modules/chat-assistant';
import { logger } from '../../utils/logger';
import type { ModelAlias } from '../../types';

const router = Router();

// POST /chat/stream — SSE streaming AI chat endpoint
router.post('/stream', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { messages, agentId, context, modelOverride } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    // Validate model override
    const validModels: ModelAlias[] = ['opus', 'sonnet', 'haiku'];
    const model = modelOverride && validModels.includes(modelOverride) ? modelOverride : undefined;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    await streamChat(
      {
        messages,
        agentId,
        context: context || 'general',
        modelOverride: model,
        workspaceId,
        userId,
      },
      (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    );

    res.end();
  } catch (err: any) {
    logger.error('Chat stream error', { error: err.message });
    // If headers already sent, try to write error event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: 'Connection lost. Please try again.' })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: 'Failed to start chat stream' });
    }
  }
});

// POST /chat — Non-streaming AI chat endpoint (backward compatible)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { message, messages, agentId, context, modelOverride } = req.body;

    // Support both old format (single message) and new format (messages array)
    let chatMessages: Array<{ role: 'user' | 'assistant'; content: string }>;

    if (messages && Array.isArray(messages)) {
      chatMessages = messages;
    } else if (message && typeof message === 'string') {
      chatMessages = [{ role: 'user', content: message }];
    } else {
      res.status(400).json({ error: 'message or messages is required' });
      return;
    }

    const validModels: ModelAlias[] = ['opus', 'sonnet', 'haiku'];
    const model = modelOverride && validModels.includes(modelOverride) ? modelOverride : undefined;

    const result = await chatSync({
      messages: chatMessages,
      agentId,
      context: context || 'general',
      modelOverride: model,
      workspaceId,
      userId,
    });

    res.json(result);
  } catch (err: any) {
    logger.error('Chat error', { error: err.message });
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

export default router;
