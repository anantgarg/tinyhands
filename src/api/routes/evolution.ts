import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  getPendingProposals, getProposalHistory,
  approveProposal, rejectProposal,
} from '../../modules/self-evolution';
import { query } from '../../db';
import { logger } from '../../utils/logger';

const router = Router();

// GET /evolution/proposals — List proposals with agent info, supports status filter + pagination
router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const agentId = req.query.agentId as string | undefined;
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let proposals: any[];
    if (status && status !== 'pending') {
      if (agentId) {
        proposals = await query(
          'SELECT * FROM evolution_proposals WHERE workspace_id = $1 AND agent_id = $2 AND status = $3 ORDER BY created_at DESC',
          [workspaceId, agentId, status]
        );
      } else {
        proposals = await query(
          'SELECT * FROM evolution_proposals WHERE workspace_id = $1 AND status = $2 ORDER BY created_at DESC',
          [workspaceId, status]
        );
      }
    } else {
      proposals = await getPendingProposals(workspaceId, agentId);
    }

    // Enrich with agent name/avatar
    const agentIds = [...new Set(proposals.map(p => p.agent_id))];
    const agentMap: Record<string, { name: string; avatar_emoji: string }> = {};
    if (agentIds.length > 0) {
      const agents = await query(
        'SELECT id, name, avatar_emoji FROM agents WHERE workspace_id = $1 AND id = ANY($2)',
        [workspaceId, agentIds]
      );
      for (const a of agents) {
        agentMap[a.id] = { name: a.name, avatar_emoji: a.avatar_emoji };
      }
    }

    const total = proposals.length;
    const paged = proposals.slice(offset, offset + limit);

    const enriched = paged.map(p => ({
      id: p.id,
      agentId: p.agent_id,
      agentName: agentMap[p.agent_id]?.name || 'Unknown Agent',
      agentAvatar: agentMap[p.agent_id]?.avatar_emoji || ':robot_face:',
      action: p.action,
      description: p.description,
      diff: p.diff,
      status: p.status,
      createdAt: p.created_at,
      resolvedAt: p.resolved_at,
    }));

    res.json({ proposals: enriched, total });
  } catch (err: any) {
    logger.error('List proposals error', { error: err.message });
    res.status(500).json({ error: 'Failed to list proposals' });
  }
});

// GET /evolution/proposals/history/:agentId — Get proposal history for an agent
router.get('/proposals/history/:agentId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const agentId = req.params.agentId as string;
    const proposals = await getProposalHistory(workspaceId, agentId);
    res.json(proposals);
  } catch (err: any) {
    logger.error('Get proposal history error', { error: err.message });
    res.status(500).json({ error: 'Failed to get proposal history' });
  }
});

// POST /evolution/proposals/:id/approve — Approve a proposal
router.post('/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const result = await approveProposal(workspaceId, id, userId);
    res.json(result);
  } catch (err: any) {
    logger.error('Approve proposal error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /evolution/proposals/:id/reject — Reject a proposal
router.post('/proposals/:id/reject', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    await rejectProposal(workspaceId, id, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Reject proposal error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export default router;
