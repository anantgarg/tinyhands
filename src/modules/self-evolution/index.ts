import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { registerCustomTool } from '../tools';
import { validateArtifactPath, validateToolName } from '../self-authoring';
import { createKBEntry } from '../knowledge-base';
import { canModifyAgent } from '../access-control';
import type { EvolutionProposal, EvolutionAction, SelfEvolutionMode } from '../../types';
import { logger } from '../../utils/logger';

// ── Evolution Proposals ──

export async function createProposal(
  workspaceId: string,
  agentId: string,
  action: EvolutionAction,
  description: string,
  diff: string
): Promise<EvolutionProposal> {
  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const id = uuid();
  const proposal: EvolutionProposal = {
    id,
    agent_id: agentId,
    action,
    description,
    diff,
    status: agent.self_evolution_mode === 'autonomous' ? 'executed' : 'pending',
    created_at: new Date().toISOString(),
    resolved_at: agent.self_evolution_mode === 'autonomous' ? new Date().toISOString() : null,
  };

  await execute(`
    INSERT INTO evolution_proposals (id, workspace_id, agent_id, action, description, diff, status, created_at, resolved_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [proposal.id, workspaceId, proposal.agent_id, proposal.action, proposal.description,
    proposal.diff, proposal.status, proposal.created_at, proposal.resolved_at]);

  // Auto-execute if autonomous
  if (agent.self_evolution_mode === 'autonomous') {
    await executeProposal(workspaceId, proposal);
  }

  // Notify admins for proposals that need review
  if (proposal.status === 'pending') {
    notifyAdminsOfProposal(workspaceId, agent.name, description).catch(() => {});
  }

  logger.info('Evolution proposal created', {
    proposalId: id, agentId, action,
    mode: agent.self_evolution_mode,
  });

  return proposal;
}

export async function approveProposal(workspaceId: string, proposalId: string, userId: string): Promise<EvolutionProposal> {
  const proposal = await getProposal(workspaceId, proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  if (!(await canModifyAgent(workspaceId, proposal.agent_id, userId))) {
    throw new Error('Insufficient permissions to approve proposal');
  }

  if (proposal.status !== 'pending') {
    throw new Error(`Proposal is ${proposal.status}, cannot approve`);
  }

  await executeProposal(workspaceId, proposal);

  await execute(
    'UPDATE evolution_proposals SET status = $1, resolved_at = NOW() WHERE id = $2 AND workspace_id = $3',
    ['approved', proposalId, workspaceId]
  );

  logger.info('Evolution proposal approved', { proposalId, userId });
  return { ...proposal, status: 'approved' };
}

export async function rejectProposal(workspaceId: string, proposalId: string, userId: string): Promise<void> {
  const proposal = await getProposal(workspaceId, proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  if (!(await canModifyAgent(workspaceId, proposal.agent_id, userId))) {
    throw new Error('Insufficient permissions');
  }

  await execute(
    'UPDATE evolution_proposals SET status = $1, resolved_at = NOW() WHERE id = $2 AND workspace_id = $3',
    ['rejected', proposalId, workspaceId]
  );

  logger.info('Evolution proposal rejected', { proposalId, userId });
}

export async function getProposal(workspaceId: string, id: string): Promise<EvolutionProposal | null> {
  const row = await queryOne<EvolutionProposal>('SELECT * FROM evolution_proposals WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  return row || null;
}

export async function getPendingProposals(workspaceId: string, agentId?: string): Promise<EvolutionProposal[]> {
  if (agentId) {
    return query<EvolutionProposal>(
      'SELECT * FROM evolution_proposals WHERE agent_id = $1 AND status = $2 AND workspace_id = $3 ORDER BY created_at DESC',
      [agentId, 'pending', workspaceId]
    );
  }
  return query<EvolutionProposal>(
    'SELECT * FROM evolution_proposals WHERE status = $1 AND workspace_id = $2 ORDER BY created_at DESC',
    ['pending', workspaceId]
  );
}

export async function getProposalHistory(workspaceId: string, agentId: string): Promise<EvolutionProposal[]> {
  return query<EvolutionProposal>(
    'SELECT * FROM evolution_proposals WHERE agent_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 50',
    [agentId, workspaceId]
  );
}

// ── Execution ──

async function executeProposal(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  try {
    switch (proposal.action) {
      case 'write_tool':
        await executeWriteTool(workspaceId, proposal);
        break;
      case 'create_mcp':
        await executeCreateMcp(workspaceId, proposal);
        break;
      case 'commit_code':
        await executeCommitCode(workspaceId, proposal);
        break;
      case 'update_prompt':
        await executeUpdatePrompt(workspaceId, proposal);
        break;
      case 'add_to_kb':
        await executeAddToKb(workspaceId, proposal);
        break;
    }
  } catch (err: any) {
    logger.error('Failed to execute proposal', {
      proposalId: proposal.id,
      action: proposal.action,
      error: err.message,
    });
    throw new Error(`Failed to execute ${proposal.action} proposal: ${err.message}`);
  }
}

async function executeWriteTool(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  const toolConfig = JSON.parse(proposal.diff);
  const toolName = toolConfig.name || `agent-tool-${proposal.id.slice(0, 8)}`;
  validateToolName(toolName);

  if (toolConfig.stored_in_db && toolConfig.code) {
    logger.info('Tool already stored in DB', { toolName });
    return;
  }

  const code = toolConfig.code || toolConfig.script || '';
  const language = toolConfig.language || 'javascript';

  await registerCustomTool(
    workspaceId,
    toolName,
    JSON.stringify(toolConfig.schema || {}),
    null,
    proposal.agent_id,
    code ? { code, language } : undefined
  );

  logger.info('Tool registered in DB', { toolName, language, codeLength: code.length });
}

async function executeCreateMcp(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  const mcpConfig = JSON.parse(proposal.diff);
  const name = mcpConfig.name || `mcp-${proposal.id.slice(0, 8)}`;
  const agent = await getAgent(workspaceId, proposal.agent_id);
  const autoApprove = agent?.self_evolution_mode === 'autonomous';

  await execute(`
    INSERT INTO mcp_configs (id, workspace_id, agent_id, name, config_json, approved, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT(agent_id, name) DO UPDATE SET
      config_json = EXCLUDED.config_json,
      updated_at = NOW()
  `, [uuid(), workspaceId, proposal.agent_id, name, JSON.stringify(mcpConfig), autoApprove]);

  logger.info('MCP config stored in DB', { name, agentId: proposal.agent_id, autoApprove });
}

async function executeCommitCode(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  const changes = JSON.parse(proposal.diff);

  if (Array.isArray(changes.files)) {
    for (const file of changes.files) {
      if (file.path && file.content) {
        validateArtifactPath(file.path);
        const ext = file.path.split('.').pop() || 'text';
        const langMap: Record<string, string> = {
          js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash',
          json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
          html: 'html', css: 'css', sql: 'sql',
        };
        const language = langMap[ext] || 'text';

        await execute(`
          INSERT INTO code_artifacts (id, workspace_id, agent_id, file_path, content, language, proposal_id, version, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW(), NOW())
          ON CONFLICT(agent_id, file_path) DO UPDATE SET
            content = EXCLUDED.content,
            language = EXCLUDED.language,
            proposal_id = EXCLUDED.proposal_id,
            version = code_artifacts.version + 1,
            updated_at = NOW()
        `, [uuid(), workspaceId, proposal.agent_id, file.path, file.content, language, proposal.id]);

        logger.info('Code artifact stored in DB', {
          path: file.path,
          language,
          agentId: proposal.agent_id,
        });
      }
    }
  }
}

async function executeUpdatePrompt(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  await updateAgent(workspaceId, proposal.agent_id, { system_prompt: proposal.diff }, proposal.agent_id);
}

async function executeAddToKb(workspaceId: string, proposal: EvolutionProposal): Promise<void> {
  const kbData = JSON.parse(proposal.diff);
  await createKBEntry(workspaceId, {
    title: kbData.title || proposal.description,
    summary: kbData.summary || '',
    content: kbData.content || proposal.diff,
    category: kbData.category || 'Agent Contributed',
    tags: kbData.tags || [],
    accessScope: 'all',
    sourceType: 'agent',
    contributedBy: proposal.agent_id,
    approved: false,
  });
}

// ── Admin Notification for Pending Proposals ──

async function notifyAdminsOfProposal(workspaceId: string, agentName: string, description: string): Promise<void> {
  try {
    const { listPlatformAdmins } = await import('../access-control');
    const { sendDMBlocks } = await import('../../slack');
    const { config } = await import('../../config');
    const admins = await listPlatformAdmins(workspaceId);
    for (const admin of admins) {
      await sendDMBlocks(admin.user_id, [
        { type: 'section', text: { type: 'mrkdwn', text: `:bulb: *Evolution Proposal* for agent *${agentName}*\n${description.slice(0, 500)}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Review in Dashboard' }, url: `${config.server.webDashboardUrl}/requests`, action_id: 'open_dashboard_requests' }] },
      ], `Evolution proposal for ${agentName}`).catch(() => {});
    }
  } catch {}
}

// ── Timeout for Approve-First ──

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export async function expireOldProposals(): Promise<number> {
  const cutoff = new Date(Date.now() - APPROVAL_TIMEOUT_MS).toISOString();

  const result = await execute(`
    UPDATE evolution_proposals
    SET status = 'rejected', resolved_at = NOW()
    WHERE status = 'pending' AND created_at < $1
  `, [cutoff]);

  if (result.rowCount > 0) {
    logger.info('Expired pending proposals', { count: result.rowCount });
  }

  return result.rowCount;
}
