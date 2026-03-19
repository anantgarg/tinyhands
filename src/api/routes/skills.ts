import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { getAvailableSkills, listSkills } from '../../modules/skills';
import { logger } from '../../utils/logger';

const router = Router();

// GET /skills/builtin — List builtin skills (MCP + prompt templates)
router.get('/builtin', (_req: Request, res: Response) => {
  try {
    const skills = getAvailableSkills();
    res.json(skills);
  } catch (err: any) {
    logger.error('List builtin skills error', { error: err.message });
    res.status(500).json({ error: 'Failed to list builtin skills' });
  }
});

// GET /skills — List all registered skills for workspace
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const skillType = req.query.type as string | undefined;
    const skills = await listSkills(workspaceId, skillType as any);
    res.json(skills);
  } catch (err: any) {
    logger.error('List skills error', { error: err.message });
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

export default router;
