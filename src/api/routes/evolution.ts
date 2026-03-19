import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  getPendingProposals, getProposalHistory,
  approveProposal, rejectProposal,
} from '../../modules/self-evolution';
import { logger } from '../../utils/logger';

const router = Router();

// GET /evolution/proposals — List proposals (optionally filter by status/agent)
router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const agentId = req.query.agentId as string | undefined;
    const status = req.query.status as string | undefined;

    if (status === 'pending' || !status) {
      const proposals = await getPendingProposals(workspaceId, agentId);
      res.json(proposals);
    } else if (agentId) {
      const proposals = await getProposalHistory(workspaceId, agentId);
      res.json(proposals);
    } else {
      const proposals = await getPendingProposals(workspaceId);
      res.json(proposals);
    }
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
