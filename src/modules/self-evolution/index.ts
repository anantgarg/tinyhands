import { v4 as uuid } from 'uuid';
import { execSync } from 'child_process';
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
    // DB-stored tool (from self-authoring module) — already registered
    logger.info('Tool stored in DB', { toolName });
    return;
  }

  // Legacy: write to disk for file-based tools
  if (toolConfig.script) {
    const { mkdirSync, writeFileSync } = require('fs');
    const scriptPath = `${process.cwd()}/tools/${toolName}.js`;
    mkdirSync(`${process.cwd()}/tools`, { recursive: true });
    writeFileSync(scriptPath, toolConfig.script, 'utf-8');
    toolConfig.script_path = scriptPath;
    logger.info('Tool script written to disk', { toolName, scriptPath });
  }

  // Store code in DB if available, otherwise use file path
  registerCustomTool(
    toolName,
    JSON.stringify(toolConfig.schema || {}),
    toolConfig.script_path || null,
    proposal.agent_id,
    toolConfig.code ? { code: toolConfig.code, language: toolConfig.language || 'javascript' } : undefined
  );

  if (!toolConfig.stored_in_db) {
    gitCommitAndPush(`Agent ${proposal.agent_id.slice(0, 8)} wrote tool: ${toolName}`);
  }
}

function executeCreateMcp(proposal: EvolutionProposal): void {
  const mcpConfig = JSON.parse(proposal.diff);
  const { mkdirSync, writeFileSync } = require('fs');

  // Write MCP server config
  const configDir = `${process.cwd()}/mcp-servers`;
  mkdirSync(configDir, { recursive: true });
  const configPath = `${configDir}/${mcpConfig.name || proposal.id.slice(0, 8)}.json`;
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');

  logger.info('MCP integration created', { configPath });
  gitCommitAndPush(`Agent ${proposal.agent_id.slice(0, 8)} created MCP: ${mcpConfig.name || 'unnamed'}`);
}

function executeCommitCode(proposal: EvolutionProposal): void {
  const changes = JSON.parse(proposal.diff);
  const { mkdirSync, writeFileSync } = require('fs');
  const { dirname } = require('path');

  if (Array.isArray(changes.files)) {
    for (const file of changes.files) {
      if (file.path && file.content) {
        mkdirSync(dirname(file.path), { recursive: true });
        writeFileSync(file.path, file.content, 'utf-8');
        logger.info('Code file written by agent', { path: file.path });
      }
    }
  }

  gitCommitAndPush(`Agent ${proposal.agent_id.slice(0, 8)}: ${proposal.description.slice(0, 60)}`);
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

function gitCommitAndPush(message: string): void {
  try {
    execSync('git add -A', { cwd: process.cwd(), timeout: 10000 });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: process.cwd(),
      timeout: 10000,
    });
    logger.info('Git commit created', { message });

    // Push to remote
    try {
      execSync('git push', { cwd: process.cwd(), timeout: 30000 });
      logger.info('Git push succeeded', { message });
    } catch (pushErr: any) {
      logger.warn('Git push failed', { error: pushErr.message });
    }
  } catch (err: any) {
    logger.warn('Git commit failed (may be no changes)', { error: err.message });
  }
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
