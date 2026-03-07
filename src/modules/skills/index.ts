import { v4 as uuid } from 'uuid';
import { query } from '../../db';
import { canModifyAgent } from '../access-control';
import type { Skill, SkillType, AgentSkill, IntegrationAccess } from '../../types';
import { logger } from '../../utils/logger';

// ── Built-in MCP Skills ──

const BUILTIN_MCP_SKILLS: Record<string, { name: string; capabilities: string[] }> = {
  linear: {
    name: 'Linear',
    capabilities: ['Read issues', 'Create issues', 'Update status'],
  },
  zendesk: {
    name: 'Zendesk',
    capabilities: ['Read tickets', 'Post replies', 'Update fields'],
  },
  notion: {
    name: 'Notion',
    capabilities: ['Read/write pages and databases'],
  },
  slack: {
    name: 'Slack',
    capabilities: ['Post to channels', 'Read message history'],
  },
  github: {
    name: 'GitHub',
    capabilities: ['Create PRs', 'Comment on issues', 'Read code'],
  },
};

// ── Built-in Prompt Template Skills ──

const BUILTIN_PROMPT_SKILLS: Record<string, { name: string; description: string; template: string }> = {
  'company-research': {
    name: 'Company Research',
    description: 'Research a company and return a structured summary',
    template: 'Research the company {{company}} and provide: overview, key products, recent news, competitive landscape, and funding history.',
  },
  'ticket-triage': {
    name: 'Ticket Triage',
    description: 'Classify severity, extract info, suggest routing',
    template: 'Analyze this support ticket and provide: severity (P0-P3), category, key entities, suggested routing team, and recommended response.',
  },
  'code-review': {
    name: 'Code Review',
    description: 'Check patterns, security, style',
    template: 'Review this code for: correctness, security vulnerabilities, performance issues, style consistency, and suggest improvements.',
  },
  'lead-enrichment': {
    name: 'Lead Enrichment',
    description: 'Pull public data, summarize for sales',
    template: 'Enrich this lead with public data: company info, role context, social presence, recent activity, and sales talking points.',
  },
  'document-filling': {
    name: 'Document Filling',
    description: 'Fill template from KB + agent knowledge',
    template: 'Fill this template by searching the knowledge base for each field. Flag any fields you cannot confidently fill.',
  },
};

// ── Skill Registry ──

export async function registerSkill(
  name: string,
  skillType: SkillType,
  config: Record<string, any>
): Promise<Skill> {
  const id = uuid();

  const skill: Skill = {
    id,
    name,
    skill_type: skillType,
    config_json: JSON.stringify(config),
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO skills (id, name, skill_type, config_json, version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [skill.id, skill.name, skill.skill_type, skill.config_json,
    skill.version, skill.created_at, skill.updated_at]);

  logger.info('Skill registered', { skillId: id, name, type: skillType });
  return skill;
}

export async function getSkill(id: string): Promise<Skill | null> {
  const { rows } = await query('SELECT * FROM skills WHERE id = $1', [id]);
  return rows[0] as Skill | null ?? null;
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const { rows } = await query('SELECT * FROM skills WHERE name = $1', [name]);
  return rows[0] as Skill | null ?? null;
}

export async function listSkills(skillType?: SkillType): Promise<Skill[]> {
  if (skillType) {
    const { rows } = await query('SELECT * FROM skills WHERE skill_type = $1 ORDER BY name', [skillType]);
    return rows as Skill[];
  }
  const { rows } = await query('SELECT * FROM skills ORDER BY name');
  return rows as Skill[];
}

export async function updateSkill(id: string, config: Record<string, any>): Promise<Skill> {
  const existing = await getSkill(id);
  if (!existing) throw new Error(`Skill ${id} not found`);

  await query(`
    UPDATE skills SET config_json = $1, version = version + 1, updated_at = NOW()::text WHERE id = $2
  `, [JSON.stringify(config), id]);

  logger.info('Skill updated', { skillId: id, version: existing.version + 1 });
  return (await getSkill(id))!;
}

// ── Agent-Skill Attachment ──

export async function attachSkillToAgent(
  agentId: string,
  skillName: string,
  permissionLevel: IntegrationAccess,
  attachedBy: string
): Promise<AgentSkill> {
  if (!(await canModifyAgent(agentId, attachedBy))) {
    throw new Error('Insufficient permissions to attach skill');
  }

  // Find or create skill
  let skill = await getSkillByName(skillName);
  if (!skill) {
    // Check if it's a built-in MCP skill
    const builtinMcp = BUILTIN_MCP_SKILLS[skillName.toLowerCase()];
    if (builtinMcp) {
      skill = await registerSkill(skillName, 'mcp', { builtin: true, ...builtinMcp });
    }

    // Check if it's a built-in prompt skill
    const builtinPrompt = BUILTIN_PROMPT_SKILLS[skillName.toLowerCase()];
    if (builtinPrompt) {
      skill = await registerSkill(skillName, 'prompt_template', { builtin: true, ...builtinPrompt });
    }

    if (!skill) throw new Error(`Skill "${skillName}" not found`);
  }

  const agentSkill: AgentSkill = {
    agent_id: agentId,
    skill_id: skill.id,
    permission_level: permissionLevel,
    attached_by: attachedBy,
    attached_at: new Date().toISOString(),
  };

  await query(`
    INSERT INTO agent_skills (agent_id, skill_id, permission_level, attached_by, attached_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (agent_id, skill_id) DO UPDATE SET
      permission_level = EXCLUDED.permission_level,
      attached_by = EXCLUDED.attached_by,
      attached_at = EXCLUDED.attached_at
  `, [agentSkill.agent_id, agentSkill.skill_id, agentSkill.permission_level,
    agentSkill.attached_by, agentSkill.attached_at]);

  logger.info('Skill attached to agent', { agentId, skillName, permissionLevel });
  return agentSkill;
}

export async function detachSkillFromAgent(agentId: string, skillId: string, userId: string): Promise<void> {
  if (!(await canModifyAgent(agentId, userId))) {
    throw new Error('Insufficient permissions to detach skill');
  }

  await query('DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2', [agentId, skillId]);
  logger.info('Skill detached from agent', { agentId, skillId });
}

export async function getAgentSkills(agentId: string): Promise<Array<Skill & { permission_level: IntegrationAccess }>> {
  const { rows } = await query(`
    SELECT s.*, asl.permission_level
    FROM agent_skills asl
    JOIN skills s ON asl.skill_id = s.id
    WHERE asl.agent_id = $1
    ORDER BY s.name
  `, [agentId]);
  return rows as Array<Skill & { permission_level: IntegrationAccess }>;
}

export function getAvailableSkills(): {
  mcp: Array<{ name: string; capabilities: string[] }>;
  prompt: Array<{ name: string; description: string }>;
} {
  return {
    mcp: Object.entries(BUILTIN_MCP_SKILLS).map(([key, val]) => ({ name: key, ...val })),
    prompt: Object.entries(BUILTIN_PROMPT_SKILLS).map(([key, val]) => ({
      name: key,
      description: val.description,
    })),
  };
}
