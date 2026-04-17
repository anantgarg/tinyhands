import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { getAvailableSkills, listSkills, registerSkill, getSkill, updateSkill, deleteSkill } from '../../modules/skills';
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

// POST /skills — Create a new skill
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { name, type, description, template, capabilities } = req.body;
    if (!name || !type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }
    const config: Record<string, any> = { description: description || '' };
    if (type === 'prompt_template') {
      config.template = template || '';
    } else if (type === 'mcp') {
      config.capabilities = capabilities || [];
    }
    const skill = await registerSkill(workspaceId, name, type, config);
    res.status(201).json(skill);
  } catch (err: any) {
    logger.error('Create skill error', { error: err.message });
    res.status(400).json({ error: "Couldn't create the skill. Please try again." });
  }
});

// PUT /skills/:id — Update a skill
router.put('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    const { name, description, template, capabilities } = req.body;
    const config: Record<string, any> = {};
    if (name !== undefined) config.name = name;
    if (description !== undefined) config.description = description;
    if (template !== undefined) config.template = template;
    if (capabilities !== undefined) config.capabilities = capabilities;
    const skill = await updateSkill(workspaceId, id, config);
    res.json(skill);
  } catch (err: any) {
    logger.error('Update skill error', { error: err.message });
    res.status(400).json({ error: "Couldn't update the skill. Please try again." });
  }
});

// DELETE /skills/:id — Delete a skill
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const id = req.params.id as string;
    await deleteSkill(workspaceId, id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete skill error', { error: err.message });
    res.status(400).json({ error: "Couldn't delete the skill. Please try again." });
  }
});

// POST /skills/generate — AI-generate a prompt template skill from description
router.post('/generate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { description } = req.body;
    if (!description) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    // Use Claude to generate a skill template
    const { createAnthropicClient } = await import('../../modules/anthropic');
    const client = await createAnthropicClient(workspaceId);
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are a skill template generator. Given a description, generate a JSON object with:
- name: kebab-case skill name
- description: one-line description
- template: a reusable prompt template with {{placeholder}} variables

Return ONLY valid JSON, no markdown fences.`,
      messages: [{ role: 'user', content: description }],
    });

    const text = response.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const generated = JSON.parse(text);
    res.json({
      name: generated.name || 'custom-skill',
      description: generated.description || description,
      template: generated.template || '',
    });
  } catch (err: any) {
    logger.error('Generate skill error', { error: err.message });
    res.status(500).json({ error: "Couldn't generate the skill. Please try again." });
  }
});

export default router;
