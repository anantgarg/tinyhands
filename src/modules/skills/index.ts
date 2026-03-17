import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { canModifyAgent } from '../access-control';
import type { Skill, SkillType, AgentSkill, IntegrationAccess } from '../../types';
import { logger } from '../../utils/logger';
import { getBuiltinSkills } from './builtins';
import type { McpSkillManifest, PromptSkillManifest } from './manifest';

// ── Built-in skill lookups (loaded from /skills/*.md) ──

function getBuiltinMcpSkills(): Record<string, { name: string; capabilities: string[] }> {
  const result: Record<string, { name: string; capabilities: string[] }> = {};
  for (const skill of getBuiltinSkills()) {
    if (skill.skillType === 'mcp') {
      const mcp = skill as McpSkillManifest;
      result[mcp.id] = { name: mcp.name, capabilities: mcp.capabilities };
    }
  }
  return result;
}

function getBuiltinPromptSkills(): Record<string, { name: string; description: string; template: string }> {
  const result: Record<string, { name: string; description: string; template: string }> = {};
  for (const skill of getBuiltinSkills()) {
    if (skill.skillType === 'prompt_template') {
      const prompt = skill as PromptSkillManifest;
      result[prompt.id] = { name: prompt.name, description: prompt.description, template: prompt.template };
    }
  }
  return result;
}

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

  await execute(`
    INSERT INTO skills (id, name, skill_type, config_json, version, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [skill.id, skill.name, skill.skill_type, skill.config_json,
    skill.version, skill.created_at, skill.updated_at]);

  logger.info('Skill registered', { skillId: id, name, type: skillType });
  return skill;
}

export async function getSkill(id: string): Promise<Skill | null> {
  const row = await queryOne<Skill>('SELECT * FROM skills WHERE id = $1', [id]);
  return row || null;
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const row = await queryOne<Skill>('SELECT * FROM skills WHERE name = $1', [name]);
  return row || null;
}

export async function listSkills(skillType?: SkillType): Promise<Skill[]> {
  if (skillType) {
    return query<Skill>('SELECT * FROM skills WHERE skill_type = $1 ORDER BY name', [skillType]);
  }
  return query<Skill>('SELECT * FROM skills ORDER BY name');
}

export async function updateSkill(id: string, config: Record<string, any>): Promise<Skill> {
  const existing = await getSkill(id);
  if (!existing) throw new Error(`Skill ${id} not found`);

  await execute(
    'UPDATE skills SET config_json = $1, version = version + 1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(config), id]
  );

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
    const builtinMcp = getBuiltinMcpSkills()[skillName.toLowerCase()];
    if (builtinMcp) {
      skill = await registerSkill(skillName, 'mcp', { builtin: true, ...builtinMcp });
    }

    // Check if it's a built-in prompt skill
    const builtinPrompt = getBuiltinPromptSkills()[skillName.toLowerCase()];
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

  await execute(`
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

  await execute('DELETE FROM agent_skills WHERE agent_id = $1 AND skill_id = $2', [agentId, skillId]);
  logger.info('Skill detached from agent', { agentId, skillId });
}

export async function getAgentSkills(agentId: string): Promise<Array<Skill & { permission_level: IntegrationAccess }>> {
  return query<Skill & { permission_level: IntegrationAccess }>(`
    SELECT s.*, asl.permission_level
    FROM agent_skills asl
    JOIN skills s ON asl.skill_id = s.id
    WHERE asl.agent_id = $1
    ORDER BY s.name
  `, [agentId]);
}

export function getAvailableSkills(): {
  mcp: Array<{ name: string; capabilities: string[] }>;
  prompt: Array<{ name: string; description: string }>;
} {
  return {
    mcp: Object.entries(getBuiltinMcpSkills()).map(([key, val]) => ({ ...val, name: key })),
    prompt: Object.entries(getBuiltinPromptSkills()).map(([key, val]) => ({
      name: key,
      description: val.description,
    })),
  };
}
