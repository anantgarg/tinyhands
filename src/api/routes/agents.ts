import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  createAgent, getAgent, listAgents, getAccessibleAgents,
  updateAgent, deleteAgent, getAgentVersions, revertAgent,
} from '../../modules/agents';
import {
  canModifyAgent, canView,
  getAgentRole, setAgentRole, removeAgentRole, getAgentRoles,
  requestUpgrade, approveUpgrade, denyUpgrade,
} from '../../modules/access-control';
import { getRunsByAgent } from '../../modules/execution';
import { addToolToAgent, removeToolFromAgent, getAgentToolSummary } from '../../modules/tools';
import { attachSkillToAgent, detachSkillFromAgent, getAgentSkills } from '../../modules/skills';
import { getAgentTriggers } from '../../modules/triggers';
import { query } from '../../db';
import { resolveUserNames } from '../helpers/user-resolver';
import { logger } from '../../utils/logger';

const router = Router();

// GET /agents — List agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId, platformRole } = getSessionUser(req);
    const agents = (platformRole === 'superadmin' || platformRole === 'admin')
      ? await listAgents(workspaceId)
      : await getAccessibleAgents(workspaceId, userId);
    res.json(agents);
  } catch (err: any) {
    logger.error('List agents error', { error: err.message });
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// POST /agents — Create agent
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agent = await createAgent(workspaceId, { ...req.body, createdBy: userId });
    res.status(201).json(agent);
  } catch (err: any) {
    logger.error('Create agent error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id — Get agent
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const agent = await getAgent(workspaceId, id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    res.json(agent);
  } catch (err: any) {
    logger.error('Get agent error', { error: err.message });
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// PATCH /agents/:id — Update agent
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const agent = await updateAgent(workspaceId, id, req.body, userId);
    res.json(agent);
  } catch (err: any) {
    logger.error('Update agent error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /agents/:id — Delete (archive) agent
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    await deleteAgent(workspaceId, id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete agent error', { error: err.message });
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// GET /agents/:id/versions — Get agent versions
router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const versions = await getAgentVersions(workspaceId, id);
    res.json(versions);
  } catch (err: any) {
    logger.error('Get agent versions error', { error: err.message });
    res.status(500).json({ error: 'Failed to get versions' });
  }
});

// POST /agents/:id/revert — Revert agent to a version
router.post('/:id/revert', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const { version } = req.body;
    if (!version) {
      res.status(400).json({ error: 'version is required' });
      return;
    }
    const agent = await revertAgent(workspaceId, id, version, userId);
    res.json(agent);
  } catch (err: any) {
    logger.error('Revert agent error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id/tools — Get agent tool summary
router.get('/:id/tools', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const summary = await getAgentToolSummary(workspaceId, id);
    res.json(summary);
  } catch (err: any) {
    logger.error('Get agent tools error', { error: err.message });
    res.status(500).json({ error: 'Failed to get tool summary' });
  }
});

// POST /agents/:id/tools — Add tool to agent
router.post('/:id/tools', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const { toolName } = req.body;
    if (!toolName) {
      res.status(400).json({ error: 'toolName is required' });
      return;
    }
    const tools = await addToolToAgent(workspaceId, id, toolName, userId);
    res.json({ tools });
  } catch (err: any) {
    logger.error('Add tool to agent error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /agents/:id/tools/:toolName — Remove tool from agent
router.delete('/:id/tools/:toolName', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const toolName = req.params.toolName as string;
    const tools = await removeToolFromAgent(workspaceId, id, toolName, userId);
    res.json({ tools });
  } catch (err: any) {
    logger.error('Remove tool from agent error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id/skills — Get agent skills
router.get('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const skills = await getAgentSkills(workspaceId, id);
    res.json(skills);
  } catch (err: any) {
    logger.error('Get agent skills error', { error: err.message });
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

// POST /agents/:id/skills — Attach skill to agent
router.post('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const { skillName, permissionLevel } = req.body;
    if (!skillName) {
      res.status(400).json({ error: 'skillName is required' });
      return;
    }
    const agentSkill = await attachSkillToAgent(
      workspaceId, id, skillName,
      permissionLevel || 'read', userId,
    );
    res.json(agentSkill);
  } catch (err: any) {
    logger.error('Attach skill error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /agents/:id/skills/:skillId — Detach skill from agent
router.delete('/:id/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const skillId = req.params.skillId as string;
    await detachSkillFromAgent(workspaceId, id, skillId, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Detach skill error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id/runs — Get agent runs
router.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 20;
    const runs = await getRunsByAgent(workspaceId, id, limit);
    const userIds = (runs as any[]).map((r: any) => r.slack_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((runs as any[]).map((r: any) => ({
      ...r,
      displayName: names[r.slack_user_id] || r.slack_user_id,
    })));
  } catch (err: any) {
    logger.error('Get agent runs error', { error: err.message });
    res.status(500).json({ error: 'Failed to get runs' });
  }
});

// GET /agents/:id/memories — Get agent memories
router.get('/:id/memories', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const memories = await query(
      'SELECT * FROM agent_memories WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
      [id, limit],
    );
    res.json(memories);
  } catch (err: any) {
    logger.error('Get agent memories error', { error: err.message });
    res.status(500).json({ error: 'Failed to get memories' });
  }
});

// GET /agents/:id/roles — Get agent roles
router.get('/:id/roles', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const roles = await getAgentRoles(workspaceId, id);
    const userIds = (roles as any[]).map((r: any) => r.user_id).concat((roles as any[]).map((r: any) => r.granted_by)).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((roles as any[]).map((r: any) => ({
      ...r,
      displayName: names[r.user_id] || r.user_id,
      grantedByName: names[r.granted_by] || r.granted_by,
    })));
  } catch (err: any) {
    logger.error('Get agent roles error', { error: err.message });
    res.status(500).json({ error: 'Failed to get roles' });
  }
});

// POST /agents/:id/roles — Set agent role for a user
router.post('/:id/roles', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const { targetUserId, role } = req.body;
    if (!targetUserId || !role) {
      res.status(400).json({ error: 'targetUserId and role are required' });
      return;
    }
    await setAgentRole(workspaceId, id, targetUserId, role, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Set agent role error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// DELETE /agents/:id/roles/:targetUserId — Remove agent role for a user
router.delete('/:id/roles/:targetUserId', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const targetUserId = req.params.targetUserId as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    await removeAgentRole(workspaceId, id, targetUserId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Remove agent role error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id/access — Get current user's access level
router.get('/:id/access', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const role = await getAgentRole(workspaceId, id, userId);
    res.json({ role });
  } catch (err: any) {
    logger.error('Get access level error', { error: err.message });
    res.status(500).json({ error: 'Failed to get access level' });
  }
});

// POST /agents/:id/upgrade-requests — Request upgrade
router.post('/:id/upgrade-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agentId = req.params.id as string;
    const { reason } = req.body;
    const id = await requestUpgrade(workspaceId, agentId, userId, reason);
    res.status(201).json({ id });
  } catch (err: any) {
    logger.error('Request upgrade error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /agents/:id/upgrade-requests/:requestId/approve — Approve upgrade
router.post('/:id/upgrade-requests/:requestId/approve', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const result = await approveUpgrade(workspaceId, requestId, userId);
    res.json(result);
  } catch (err: any) {
    logger.error('Approve upgrade error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// POST /agents/:id/upgrade-requests/:requestId/deny — Deny upgrade
router.post('/:id/upgrade-requests/:requestId/deny', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    const requestId = req.params.requestId as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    await denyUpgrade(workspaceId, requestId, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Deny upgrade error', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// GET /agents/:id/triggers — Get agent triggers
router.get('/:id/triggers', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const triggers = await getAgentTriggers(workspaceId, id);
    res.json(triggers);
  } catch (err: any) {
    logger.error('Get agent triggers error', { error: err.message });
    res.status(500).json({ error: 'Failed to get triggers' });
  }
});

export default router;
