import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { registerCustomTool } from '../tools';
import { createKBEntry } from '../knowledge-base';
import { canModifyAgent } from '../access-control';
import type { EvolutionProposal, EvolutionAction, SelfEvolutionMode } from '../../types';
import { logger } from '../../utils/logger';

// ── Evolution Proposals ──

export function createProposal(
  agentId: string,
  action: EvolutionAction,
  description: string,
  diff: string
): EvolutionProposal {
  const db = getDb();
  const agent = getAgent(agentId);
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

  db.prepare(`
    INSERT INTO evolution_proposals (id, agent_id, action, description, diff, status, created_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(proposal.id, proposal.agent_id, proposal.action, proposal.description,
    proposal.diff, proposal.status, proposal.created_at, proposal.resolved_at);

  // Auto-execute if autonomous
  if (agent.self_evolution_mode === 'autonomous') {
    executeProposal(proposal);
  }

  logger.info('Evolution proposal created', {
    proposalId: id, agentId, action,
    mode: agent.self_evolution_mode,
  });

  return proposal;
}

export function approveProposal(proposalId: string, userId: string): EvolutionProposal {
  const db = getDb();
  const proposal = getProposal(proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  if (!canModifyAgent(proposal.agent_id, userId)) {
    throw new Error('Insufficient permissions to approve proposal');
  }

  if (proposal.status !== 'pending') {
    throw new Error(`Proposal is ${proposal.status}, cannot approve`);
  }

  executeProposal(proposal);

  db.prepare(
    'UPDATE evolution_proposals SET status = ?, resolved_at = datetime("now") WHERE id = ?'
  ).run('approved', proposalId);

  logger.info('Evolution proposal approved', { proposalId, userId });
  return { ...proposal, status: 'approved' };
}

export function rejectProposal(proposalId: string, userId: string): void {
  const db = getDb();
  const proposal = getProposal(proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  if (!canModifyAgent(proposal.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }

  db.prepare(
    'UPDATE evolution_proposals SET status = ?, resolved_at = datetime("now") WHERE id = ?'
  ).run('rejected', proposalId);

  logger.info('Evolution proposal rejected', { proposalId, userId });
}

export function getProposal(id: string): EvolutionProposal | null {
  const db = getDb();
  return db.prepare('SELECT * FROM evolution_proposals WHERE id = ?').get(id) as EvolutionProposal | null;
}

export function getPendingProposals(agentId?: string): EvolutionProposal[] {
  const db = getDb();
  if (agentId) {
    return db.prepare(
      'SELECT * FROM evolution_proposals WHERE agent_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(agentId, 'pending') as EvolutionProposal[];
  }
  return db.prepare(
    'SELECT * FROM evolution_proposals WHERE status = ? ORDER BY created_at DESC'
  ).all('pending') as EvolutionProposal[];
}

export function getProposalHistory(agentId: string): EvolutionProposal[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM evolution_proposals WHERE agent_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(agentId) as EvolutionProposal[];
}

// ── Execution ──

function executeProposal(proposal: EvolutionProposal): void {
  switch (proposal.action) {
    case 'write_tool':
      executeWriteTool(proposal);
      break;
    case 'create_mcp':
      executeCreateMcp(proposal);
      break;
    case 'commit_code':
      executeCommitCode(proposal);
      break;
    case 'update_prompt':
      executeUpdatePrompt(proposal);
      break;
    case 'add_to_kb':
      executeAddToKb(proposal);
      break;
  }
}

function executeWriteTool(proposal: EvolutionProposal): void {
  const toolConfig = JSON.parse(proposal.diff);
  const toolName = toolConfig.name || `agent-tool-${proposal.id.slice(0, 8)}`;

  if (toolConfig.stored_in_db && toolConfig.code) {
    // Already registered by self-authoring module
    logger.info('Tool already stored in DB', { toolName });
    return;
  }

  // All tool code goes into DB — use script or code field
  const code = toolConfig.code || toolConfig.script || '';
  const language = toolConfig.language || 'javascript';

  registerCustomTool(
    toolName,
    JSON.stringify(toolConfig.schema || {}),
    null, // no file path — everything in DB
    proposal.agent_id,
    code ? { code, language } : undefined
  );

  logger.info('Tool registered in DB', { toolName, language, codeLength: code.length });
}

function executeCreateMcp(proposal: EvolutionProposal): void {
  const db = getDb();
  const mcpConfig = JSON.parse(proposal.diff);
  const name = mcpConfig.name || `mcp-${proposal.id.slice(0, 8)}`;
  const agent = getAgent(proposal.agent_id);
  const autoApprove = agent?.self_evolution_mode === 'autonomous';

  // Upsert MCP config in DB
  db.prepare(`
    INSERT INTO mcp_configs (id, agent_id, name, config_json, approved, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(agent_id, name) DO UPDATE SET
      config_json = excluded.config_json,
      updated_at = datetime('now')
  `).run(uuid(), proposal.agent_id, name, JSON.stringify(mcpConfig), autoApprove ? 1 : 0);

  logger.info('MCP config stored in DB', { name, agentId: proposal.agent_id, autoApprove });
}

function executeCommitCode(proposal: EvolutionProposal): void {
  const db = getDb();
  const changes = JSON.parse(proposal.diff);

  if (Array.isArray(changes.files)) {
    for (const file of changes.files) {
      if (file.path && file.content) {
        // Detect language from file extension
        const ext = file.path.split('.').pop() || 'text';
        const langMap: Record<string, string> = {
          js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash',
          json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
          html: 'html', css: 'css', sql: 'sql',
        };
        const language = langMap[ext] || 'text';

        // Upsert into code_artifacts table
        db.prepare(`
          INSERT INTO code_artifacts (id, agent_id, file_path, content, language, proposal_id, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
          ON CONFLICT(agent_id, file_path) DO UPDATE SET
            content = excluded.content,
            language = excluded.language,
            proposal_id = excluded.proposal_id,
            version = code_artifacts.version + 1,
            updated_at = datetime('now')
        `).run(uuid(), proposal.agent_id, file.path, file.content, language, proposal.id);

        logger.info('Code artifact stored in DB', {
          path: file.path,
          language,
          agentId: proposal.agent_id,
        });
      }
    }
  }
}

function executeUpdatePrompt(proposal: EvolutionProposal): void {
  updateAgent(proposal.agent_id, { system_prompt: proposal.diff }, proposal.agent_id);
}

function executeAddToKb(proposal: EvolutionProposal): void {
  const kbData = JSON.parse(proposal.diff);
  createKBEntry({
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

// ── Timeout for Approve-First ──

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function expireOldProposals(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - APPROVAL_TIMEOUT_MS).toISOString();

  const result = db.prepare(`
    UPDATE evolution_proposals
    SET status = 'rejected', resolved_at = datetime('now')
    WHERE status = 'pending' AND created_at < ?
  `).run(cutoff);

  if (result.changes > 0) {
    logger.info('Expired pending proposals', { count: result.changes });
  }

  return result.changes;
}
