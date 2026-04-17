import { Router, Request, Response } from 'express';
import { getSessionUser } from '../middleware/auth';
import {
  createAgent, getAgent, listAgents, getAccessibleAgents,
  updateAgent, deleteAgent, getAgentVersions, revertAgent,
} from '../../modules/agents';
import {
  canModifyAgent, canView, isPlatformAdmin, listPlatformAdmins,
  getAgentRole, setAgentRole, removeAgentRole, getAgentRoles,
  requestUpgrade, approveUpgrade, denyUpgrade,
  createToolRequest, listToolRequests, listAgentToolRequests,
  approveToolRequest, denyToolRequest,
} from '../../modules/access-control';
import { getRunsByAgent as _getRunsByAgent } from '../../modules/execution';
import { addToolToAgent, removeToolFromAgent, getAgentToolSummary } from '../../modules/tools';
import { attachSkillToAgent, detachSkillFromAgent, getAgentSkills } from '../../modules/skills';
import { getAgentTriggers } from '../../modules/triggers';
import { query, queryOne } from '../../db';
import { resolveUserNames } from '../helpers/user-resolver';
import { logger } from '../../utils/logger';
import { config } from '../../config';

const router = Router();

/** Convert top-level snake_case keys to camelCase so both conventions are accepted. */
function snakeToCamelKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return result;
}

// GET /agents — List agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId, platformRole } = getSessionUser(req);
    const agents = (platformRole === 'superadmin' || platformRole === 'admin')
      ? await listAgents(workspaceId)
      : await getAccessibleAgents(workspaceId, userId);

    // Resolve creator display names
    const creatorIds = (agents as any[]).map((a: any) => a.created_by).filter(Boolean);
    const names = await resolveUserNames(creatorIds);
    const enriched = (agents as any[]).map((a: any) => ({
      ...a,
      createdByDisplayName: names[a.created_by] || undefined,
    }));

    res.json(enriched);
  } catch (err: any) {
    logger.error('List agents error', { error: err.message });
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// POST /agents — Create agent
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);

    const params = { ...(snakeToCamelKeys(req.body) as any), createdBy: userId };

    // If non-admin is creating an agent with write tools, filter them out
    // and create tool_requests for any that would use team credentials
    const writeToolsPending: string[] = [];
    if ((params.tools || []).some((t: string) => t.endsWith('-write'))) {
      const isAdmin = await isPlatformAdmin(workspaceId, userId);
      if (!isAdmin) {
        const { getIntegrationIdForTool, getTeamConnection } = await import('../../modules/connections');
        const writeTools = (params.tools as string[]).filter(t => t.endsWith('-write'));
        for (const toolName of writeTools) {
          const integrationId = getIntegrationIdForTool(toolName);
          const teamConn = await getTeamConnection(workspaceId, integrationId);
          if (teamConn) {
            writeToolsPending.push(toolName);
          }
        }
        // Remove pending write tools from the tools array before creating the agent
        if (writeToolsPending.length > 0) {
          params.tools = (params.tools as string[]).filter((t: string) => !writeToolsPending.includes(t));
        }
      }
    }

    const agent = await createAgent(workspaceId, params);

    // Create tool_requests for write tools that need admin approval
    if (writeToolsPending.length > 0) {
      for (const toolName of writeToolsPending) {
        await createToolRequest(workspaceId, agent.id, toolName, 'read-write', userId);
      }
      // Notify admins
      try {
        await notifyAdminsOfToolRequests(workspaceId, agent.id, agent.name, writeToolsPending, userId);
      } catch { /* best-effort */ }
    }

    // Process credential_modes from the creation flow
    try {
      const credentialModes = req.body.credential_modes;
      if (credentialModes && typeof credentialModes === 'object') {
        const { getIntegrationIdForTool, setAgentToolConnection } = await import('../../modules/connections');
        const isAdmin = await isPlatformAdmin(workspaceId, userId);
        const agentTools = (agent.tools || []) as string[];

        for (const [integrationId, mode] of Object.entries(credentialModes)) {
          const modeStr = mode as string;
          // Find tools belonging to this integration
          const matchingTools = agentTools.filter(t => getIntegrationIdForTool(t) === integrationId);

          for (const toolName of matchingTools) {
            if (modeStr === 'team' && !isAdmin) {
              // Non-admin requesting team credentials: create tool request
              const accessLevel = toolName.endsWith('-write') ? 'read-write' : 'read-only';
              await createToolRequest(workspaceId, agent.id, toolName, accessLevel, userId, 'Requested team credentials during creation');
            } else if (modeStr === 'team' && isAdmin) {
              // Admin: set team mode directly
              await setAgentToolConnection(workspaceId, agent.id, toolName, 'team', null, userId);
            } else if (modeStr === 'delegated' || modeStr === 'runtime') {
              // delegated or runtime: set directly
              await setAgentToolConnection(workspaceId, agent.id, toolName, modeStr, null, userId);
            }
          }
        }

        // Notify admins if any team credential requests were created by non-admin
        if (!isAdmin) {
          const teamRequestTools: string[] = [];
          for (const [integrationId, mode] of Object.entries(credentialModes)) {
            if (mode === 'team') {
              const matching = agentTools.filter(t => getIntegrationIdForTool(t) === integrationId);
              teamRequestTools.push(...matching);
            }
          }
          if (teamRequestTools.length > 0) {
            try {
              await notifyAdminsOfToolRequests(workspaceId, agent.id, agent.name, teamRequestTools, userId);
            } catch { /* best-effort */ }
          }
        }
      }
    } catch (err: any) {
      logger.warn('Failed to process credential_modes during creation', { error: err.message });
    }

    res.status(201).json(agent);
  } catch (err: any) {
    logger.error('Create agent error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t create the agent. Please try again.' });
  }
});

// POST /agents/analyze-goal — Analyze a goal and generate agent config (must be before /:id)
router.post('/analyze-goal', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { goal } = req.body;
    if (!goal) {
      res.status(400).json({ error: 'goal is required' });
      return;
    }
    const { analyzeGoal } = await import('../../modules/agents/goal-analyzer');
    const result = await analyzeGoal(workspaceId, goal);
    res.json(result);
  } catch (err: any) {
    logger.error('Analyze goal error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t analyze the goal. Please try again.' });
  }
});

// GET /agents/pending-counts — Pending review counts across all request types (must be before /:id)
router.get('/pending-counts', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const [upgrades, toolRequests, evolutionProposals, featureRequests, kbContributions] = await Promise.all([
      queryOne<{count:number}>('SELECT count(*)::int as count FROM upgrade_requests WHERE workspace_id = $1 AND status = \'pending\'', [workspaceId]),
      queryOne<{count:number}>('SELECT count(*)::int as count FROM tool_requests WHERE workspace_id = $1 AND status = \'pending\'', [workspaceId]),
      queryOne<{count:number}>('SELECT count(*)::int as count FROM evolution_proposals WHERE workspace_id = $1 AND status = \'pending\'', [workspaceId]),
      queryOne<{count:number}>('SELECT count(*)::int as count FROM pending_confirmations WHERE data->>\'type\' IN (\'feature_request\', \'new_tool_request\') AND expires_at > NOW()', []),
      queryOne<{count:number}>('SELECT count(*)::int as count FROM kb_entries WHERE workspace_id = $1 AND approved = false', [workspaceId]),
    ]);
    const counts = {
      upgrades: upgrades?.count || 0,
      toolRequests: toolRequests?.count || 0,
      evolutionProposals: evolutionProposals?.count || 0,
      featureRequests: featureRequests?.count || 0,
      kbContributions: kbContributions?.count || 0,
      total: 0,
    };
    counts.total = counts.upgrades + counts.toolRequests + counts.evolutionProposals + counts.featureRequests + counts.kbContributions;
    res.json(counts);
  } catch (err: any) {
    logger.error('Pending counts error', { error: err.message });
    res.status(500).json({ error: 'Failed to get pending counts' });
  }
});

// GET /agents/upgrade-requests — List all pending upgrade requests (must be before /:id)
router.get('/upgrade-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const rows = await query('SELECT ur.*, a.name as agent_name FROM upgrade_requests ur LEFT JOIN agents a ON ur.agent_id = a.id WHERE ur.workspace_id = $1 AND ur.status = \'pending\' ORDER BY ur.created_at DESC', [workspaceId]);
    // Resolve user display names
    const userIds = [...new Set((rows as any[]).map((r: any) => r.user_id))];
    const names = await resolveUserNames(userIds);
    res.json((rows as any[]).map((r: any) => ({
      id: r.id, userId: r.user_id, displayName: names[r.user_id] || r.user_id,
      agentId: r.agent_id, agentName: r.agent_name, requestedRole: r.requested_role,
      reason: r.reason, status: r.status, createdAt: r.created_at,
    })));
  } catch (err: any) {
    logger.error('List upgrade requests error', { error: err.message });
    res.status(500).json({ error: 'Failed to list upgrade requests' });
  }
});

// GET /agents/tool-requests — List all tool requests (workspace-wide, must be before /:id)
router.get('/tool-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const status = req.query.status as string | undefined;
    const requests = await listToolRequests(workspaceId, status);
    const userIds = (requests as any[]).map((r: any) => r.requested_by).filter(Boolean);
    const names = await resolveUserNames(userIds);
    const agentIds = (requests as any[]).map((r: any) => r.agent_id).filter(Boolean);
    const agentRows = agentIds.length > 0
      ? await query('SELECT id, name FROM agents WHERE id = ANY($1)', [agentIds])
      : [];
    const agentMap: Record<string, string> = {};
    for (const a of agentRows as any[]) { agentMap[a.id] = a.name; }
    res.json((requests as any[]).map((r: any) => ({
      ...r,
      requestedByName: names[r.requested_by] || r.requested_by,
      agentName: agentMap[r.agent_id] || r.agent_id,
    })));
  } catch (err: any) {
    logger.error('List tool requests error', { error: err.message });
    res.status(500).json({ error: 'Failed to list tool requests' });
  }
});

// ── Feature Requests ──

// GET /agents/feature-requests — List feature requests (must be before /:id)
router.get('/feature-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const rows = await query(
      `SELECT id, data, created_at FROM pending_confirmations
       WHERE data->>'type' IN ('feature_request', 'new_tool_request') AND expires_at > NOW()
       AND (workspace_id = $1 OR workspace_id IS NULL)
       ORDER BY created_at DESC`,
      [workspaceId]
    );
    const userIds = (rows as any[]).map((r: any) => r.data?.requestedBy).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((rows as any[]).map((r: any) => {
      const isNewToolRequest = r.data.type === 'new_tool_request';
      return {
        id: r.id,
        goal: isNewToolRequest ? r.data.goal || '' : r.data.goal,
        blockers: isNewToolRequest
          ? (r.data.newTools || []).map((t: any) => `${t.name}: ${t.description}`)
          : (r.data.analysis?.blockers || []),
        summary: isNewToolRequest
          ? `New tools needed for agent ${r.data.agentName || ''}`
          : (r.data.analysis?.summary || ''),
        suggestedName: isNewToolRequest
          ? (r.data.agentName || '')
          : (r.data.analysis?.agent_name || ''),
        requestedBy: r.data.requestedBy,
        requestedByName: names[r.data.requestedBy] || r.data.requestedBy,
        createdAt: r.created_at,
      };
    }));
  } catch (err: any) {
    logger.error('List feature requests error', { error: err.message });
    res.status(500).json({ error: 'Failed to list feature requests' });
  }
});

// DELETE /agents/feature-requests/:id — Dismiss a feature request (must be before /:id)
router.delete('/feature-requests/:requestId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const requestId = req.params.requestId as string;
    await query(
      `DELETE FROM pending_confirmations WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
      [requestId, workspaceId]
    );
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Dismiss feature request error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t dismiss the request. Please try again.' });
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

    // Resolve channel names (best-effort, 3s timeout to avoid blocking)
    const channelIds = (agent as any).channel_ids || [];
    const channelNames: Record<string, string> = {};
    try {
      if (channelIds.length > 0) {
        const { getSlackApp } = await import('../../slack');
        const client = getSlackApp().client;
        const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
        const lookup = Promise.allSettled(channelIds.map(async (chId: string) => {
          const info = await client.conversations.info({ channel: chId });
          return { id: chId, name: info.channel?.name };
        }));
        const results = await Promise.race([lookup, timeout]).catch(() => [] as PromiseSettledResult<any>[]);
        for (const r of (results as PromiseSettledResult<any>[])) {
          if (r.status === 'fulfilled' && r.value.name) {
            channelNames[r.value.id] = r.value.name;
          }
        }
      }
    } catch { /* Slack not available */ }

    // Get current user's role for this agent
    const userAgentRole = await getAgentRole(workspaceId, id, userId);

    // Resolve Slack user mentions in system_prompt (best-effort)
    let mentionedUsers: Record<string, string> = {};
    try {
      const prompt = (agent as any).system_prompt || '';
      const mentionIds = [...prompt.matchAll(/<@([A-Z0-9]+)>/g)].map((m: RegExpMatchArray) => m[1]);
      if (mentionIds.length > 0) {
        mentionedUsers = await resolveUserNames([...new Set(mentionIds)]);
      }
    } catch { /* ignore */ }

    res.json({ ...(agent as any), channel_names: channelNames, user_role: userAgentRole, mentioned_users: mentionedUsers });
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

    const updates = { ...req.body };
    const agent = await updateAgent(workspaceId, id, updates, userId);
    res.json(agent);
  } catch (err: any) {
    logger.error('Update agent error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t update the agent. Please try again.' });
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
    const userIds = (versions as any[]).map((v: any) => v.changed_by).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((versions as any[]).map((v: any) => ({
      id: v.id,
      agentId: v.agent_id,
      version: v.version,
      systemPrompt: v.system_prompt,
      changeNote: v.change_note,
      changedBy: v.changed_by,
      changedByName: names[v.changed_by] || v.changed_by,
      createdAt: v.created_at,
      model: v.model || null,
      tools: v.tools ? (typeof v.tools === 'string' ? JSON.parse(v.tools) : v.tools) : null,
      maxTurns: v.max_turns ?? null,
      memoryEnabled: v.memory_enabled ?? null,
      mentionsOnly: v.mentions_only ?? null,
      respondToAll: v.respond_to_all ?? null,
      defaultAccess: v.default_access || null,
      writePolicy: v.write_policy || null,
    })));
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
    res.status(400).json({ error: 'Couldn\'t revert the agent. Please try again.' });
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

    // When a non-admin adds a write tool that would use team credentials,
    // create a tool_request for admin approval instead of attaching directly
    if (toolName.endsWith('-write')) {
      const isAdmin = await isPlatformAdmin(workspaceId, userId);
      if (!isAdmin) {
        const { getIntegrationIdForTool, getTeamConnection } = await import('../../modules/connections');
        const integrationId = getIntegrationIdForTool(toolName);
        const teamConn = await getTeamConnection(workspaceId, integrationId);
        if (teamConn) {
          const agent = await getAgent(workspaceId, id);
          await createToolRequest(workspaceId, id, toolName, 'read-write', userId);
          // Notify admins
          try {
            await notifyAdminsOfToolRequests(workspaceId, id, agent?.name || id, [toolName], userId);
          } catch { /* best-effort */ }
          res.status(202).json({ status: 'pending_approval', message: 'Adding this tool requires admin approval.' });
          return;
        }
      }
    }

    const tools = await addToolToAgent(workspaceId, id, toolName, userId);

    // If a sibling tool from the same integration already has a credential mode,
    // inherit it for the newly added tool. This ensures that adding -write after
    // -read was already set to delegated doesn't leave -write without a mode.
    try {
      const { getIntegrationIdForTool, listAgentToolConnections, setAgentToolConnection } = await import('../../modules/connections');
      const integrationId = getIntegrationIdForTool(toolName);
      const existingAtcs = await listAgentToolConnections(workspaceId, id);
      const siblingAtc = existingAtcs.find(
        (atc: any) => atc.tool_name !== toolName && getIntegrationIdForTool(atc.tool_name) === integrationId
      );
      if (siblingAtc) {
        await setAgentToolConnection(workspaceId, id, toolName, siblingAtc.connection_mode, siblingAtc.connection_id, userId);
      }
    } catch { /* best-effort */ }

    res.json({ tools });
  } catch (err: any) {
    logger.error('Add tool to agent error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t add the tool. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t remove the tool. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t attach the skill. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t remove the skill. Please try again.' });
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
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;

    // Get total count
    const countQuery = status
      ? await query('SELECT count(*)::int as count FROM run_history WHERE workspace_id = $1 AND agent_id = $2 AND status = $3', [workspaceId, id, status])
      : await query('SELECT count(*)::int as count FROM run_history WHERE workspace_id = $1 AND agent_id = $2', [workspaceId, id]);
    const total = countQuery[0]?.count ?? 0;

    // Get paginated runs
    const offset = (page - 1) * limit;
    let runs;
    if (status) {
      runs = await query(
        'SELECT * FROM run_history WHERE workspace_id = $1 AND agent_id = $2 AND status = $3 ORDER BY created_at DESC LIMIT $4 OFFSET $5',
        [workspaceId, id, status, limit, offset]
      );
    } else {
      runs = await query(
        'SELECT * FROM run_history WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
        [workspaceId, id, limit, offset]
      );
    }

    const userIds = (runs as any[]).map((r: any) => r.slack_user_id).filter(Boolean);
    const names = await resolveUserNames(userIds);

    res.json({
      runs: (runs as any[]).map((r: any) => ({
        ...r,
        displayName: names[r.slack_user_id] || r.slack_user_id,
      })),
      total,
    });
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
      'SELECT * FROM agent_memory WHERE workspace_id = $1 AND agent_id = $2 ORDER BY created_at DESC LIMIT $3',
      [workspaceId, id, limit],
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
    res.status(400).json({ error: 'Couldn\'t update the role. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t remove the role. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t submit the upgrade request. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t approve the upgrade. Please try again.' });
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
    res.status(400).json({ error: 'Couldn\'t deny the upgrade. Please try again.' });
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
    res.json((triggers as any[]).map((t: any) => ({
      id: t.id,
      agentId: t.agent_id,
      type: t.trigger_type,
      config: typeof t.config_json === 'string' ? JSON.parse(t.config_json || '{}') : (t.config_json || {}),
      enabled: t.status === 'active',
      lastTriggeredAt: t.last_triggered_at || t.last_fired_at || null,
      createdAt: t.created_at,
    })));
  } catch (err: any) {
    logger.error('Get agent triggers error', { error: err.message });
    res.status(500).json({ error: 'Failed to get triggers' });
  }
});

// ── Tool Requests ──

// GET /agents/:id/tool-requests — List tool requests for agent
router.get('/:id/tool-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const requests = await listAgentToolRequests(workspaceId, id);
    const userIds = (requests as any[]).map((r: any) => r.requested_by).filter(Boolean);
    const names = await resolveUserNames(userIds);
    res.json((requests as any[]).map((r: any) => ({
      ...r,
      requestedByName: names[r.requested_by] || r.requested_by,
    })));
  } catch (err: any) {
    logger.error('List agent tool requests error', { error: err.message });
    res.status(500).json({ error: 'Failed to list tool requests' });
  }
});

// POST /agents/:id/tool-requests — Create tool request
router.post('/:id/tool-requests', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const agentId = req.params.id as string;
    const { toolName, accessLevel, reason } = req.body;
    if (!toolName) {
      res.status(400).json({ error: 'toolName is required' });
      return;
    }
    const id = await createToolRequest(workspaceId, agentId, toolName, accessLevel || 'read-only', userId, reason);
    res.status(201).json({ id });
  } catch (err: any) {
    logger.error('Create tool request error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t submit the tool request. Please try again.' });
  }
});

// POST /agents/:id/tool-requests/:requestId/approve — Approve tool request
router.post('/:id/tool-requests/:requestId/approve', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await isPlatformAdmin(workspaceId, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const result = await approveToolRequest(workspaceId, req.params.requestId as string, userId);
    res.json(result);
  } catch (err: any) {
    logger.error('Approve tool request error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t approve the tool request. Please try again.' });
  }
});

// POST /agents/:id/tool-requests/:requestId/deny — Deny tool request
router.post('/:id/tool-requests/:requestId/deny', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    await denyToolRequest(workspaceId, req.params.requestId as string, userId);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Deny tool request error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t deny the tool request. Please try again.' });
  }
});

// ── Self-Improvement ──

// POST /agents/:id/suggest-improvement — Submit critique, get AI-proposed prompt improvement
router.post('/:id/suggest-improvement', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const { feedback } = req.body;
    if (!feedback) {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    const agent = await getAgent(workspaceId, id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    const { generatePromptDiff } = await import('../../modules/self-improvement');
    const diff = await generatePromptDiff(workspaceId, (agent as any).system_prompt, feedback, '');
    res.json(diff);
  } catch (err: any) {
    logger.error('Suggest improvement error', { error: err.message });
    res.status(500).json({ error: 'Couldn\'t generate the improvement. Please try again.' });
  }
});

// POST /agents/:id/apply-improvement — Apply proposed prompt improvement
router.post('/:id/apply-improvement', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canModifyAgent(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const { newPrompt, changeNote } = req.body;
    if (!newPrompt) {
      res.status(400).json({ error: 'newPrompt is required' });
      return;
    }
    const { applyPromptDiff } = await import('../../modules/self-improvement');
    const result = await applyPromptDiff(workspaceId, id, newPrompt, changeNote || 'Applied improvement from dashboard', userId);
    res.json(result);
  } catch (err: any) {
    logger.error('Apply improvement error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t apply the improvement. Please try again.' });
  }
});

// GET /agents/:id/prompt-size — Check prompt token count
router.get('/:id/prompt-size', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const id = req.params.id as string;
    if (!(await canView(workspaceId, id, userId))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const { checkPromptSize } = await import('../../modules/self-improvement');
    const result = await checkPromptSize(workspaceId, id);
    res.json(result);
  } catch (err: any) {
    logger.error('Check prompt size error', { error: err.message });
    res.status(400).json({ error: 'Couldn\'t check the prompt size. Please try again.' });
  }
});

// ── Helper: Notify admins when write tool requests are created ──

async function notifyAdminsOfToolRequests(
  workspaceId: string,
  agentId: string,
  agentName: string,
  toolNames: string[],
  requestedBy: string,
): Promise<void> {
  const admins = await listPlatformAdmins(workspaceId);
  if (admins.length === 0) return;

  try {
    const { sendDMBlocks } = await import('../../slack');
    const toolList = toolNames.map(t => `\`${t}\``).join(', ');
    for (const admin of admins) {
      await sendDMBlocks(admin.user_id, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:lock: <@${requestedBy}> requested to add write tool(s) ${toolList} to agent *${agentName}*. Review pending tool requests in the dashboard.`,
          },
        },
        {
          type: 'actions',
          elements: [{
            type: 'button',
            text: { type: 'plain_text', text: 'View in Dashboard' },
            url: `${config.server.webDashboardUrl}/requests`,
            action_id: 'open_dashboard_requests',
          }],
        },
      ], `Write tool request for ${agentName}`).catch(() => {});
    }
  } catch {
    logger.warn('Failed to notify admins of tool requests', { workspaceId, agentId });
  }
}

export default router;
