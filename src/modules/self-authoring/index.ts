import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
import { getAgent } from '../agents';
import { registerCustomTool, getCustomTool } from '../tools';
import { registerSkill, attachSkillToAgent } from '../skills';
import { createProposal } from '../self-evolution';
import { canModifyAgent } from '../access-control';
import type { CustomTool, AuthoredSkill, EvolutionAction } from '../../types';
import { logger } from '../../utils/logger';

// ── AI-Powered Tool Authoring ──

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  language: 'javascript' | 'python' | 'bash';
}

export interface AuthorToolResult {
  tool: CustomTool;
  code: string;
  requiresApproval: boolean;
}

/**
 * Agent generates a tool spec + implementation via AI,
 * stores the code in DB, and creates an evolution proposal.
 */
export async function authorTool(
  agentId: string,
  taskDescription: string,
): Promise<AuthorToolResult> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  // Use AI to generate tool specification and implementation
  const { spec, code } = await generateToolCode(taskDescription, agent.name);

  // Validate generated code (basic static checks)
  validateToolCode(code, spec.language);

  // Store in DB via evolution proposal system
  const needsApproval = agent.self_evolution_mode === 'approve-first';

  const tool = registerCustomTool(
    spec.name,
    JSON.stringify(spec.inputSchema),
    null,
    agentId,
    { code, language: spec.language, autoApprove: !needsApproval }
  );

  // Create evolution proposal for audit trail
  createProposal(agentId, 'write_tool', `Auto-authored tool: ${spec.name} — ${spec.description}`, JSON.stringify({
    name: spec.name,
    description: spec.description,
    schema: spec.inputSchema,
    language: spec.language,
    code,
    stored_in_db: true,
  }));

  logger.info('Agent authored new tool', {
    agentId,
    toolName: spec.name,
    language: spec.language,
    codeLength: code.length,
    needsApproval,
  });

  return { tool, code, requiresApproval: needsApproval };
}

/**
 * Agent generates a reusable prompt template skill from experience.
 */
export async function authorSkill(
  agentId: string,
  taskDescription: string,
): Promise<AuthoredSkill> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const { name, description, template } = await generateSkillTemplate(taskDescription, agent.name);

  const db = getDb();
  const id = uuid();
  const needsApproval = agent.self_evolution_mode === 'approve-first';

  const skill: AuthoredSkill = {
    id,
    agent_id: agentId,
    name,
    description,
    skill_type: 'prompt_template',
    template,
    version: 1,
    approved: !needsApproval,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO authored_skills (id, agent_id, name, description, skill_type, template, version, approved, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(skill.id, skill.agent_id, skill.name, skill.description,
    skill.skill_type, skill.template, skill.version, skill.approved ? 1 : 0,
    skill.created_at, skill.updated_at);

  // Also register in the global skills registry so other agents can use it
  const globalSkill = registerSkill(name, 'prompt_template', {
    authored_by: agentId,
    description,
    template,
  });

  // Auto-attach to the authoring agent
  attachSkillToAgent(agentId, name, 'write', agentId);

  // Create evolution proposal for audit
  createProposal(agentId, 'add_to_kb', `Authored skill: ${name}`, JSON.stringify({
    name, description, template, stored_in_db: true,
  }));

  logger.info('Agent authored new skill', { agentId, skillName: name, needsApproval });
  return skill;
}

// ── Skill/Tool Queries ──

export function getAuthoredSkills(agentId: string): AuthoredSkill[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM authored_skills WHERE agent_id = ? ORDER BY created_at DESC'
  ).all(agentId) as AuthoredSkill[];
}

export function getAuthoredSkill(id: string): AuthoredSkill | null {
  const db = getDb();
  return db.prepare('SELECT * FROM authored_skills WHERE id = ?').get(id) as AuthoredSkill | null;
}

export function approveAuthoredSkill(id: string, userId: string): void {
  const db = getDb();
  const skill = getAuthoredSkill(id);
  if (!skill) throw new Error(`Authored skill ${id} not found`);
  if (!canModifyAgent(skill.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }
  db.prepare('UPDATE authored_skills SET approved = 1, updated_at = datetime("now") WHERE id = ?').run(id);
  logger.info('Authored skill approved', { id, userId });
}

export function updateAuthoredSkillTemplate(id: string, template: string, userId: string): void {
  const db = getDb();
  const skill = getAuthoredSkill(id);
  if (!skill) throw new Error(`Authored skill ${id} not found`);
  if (!canModifyAgent(skill.agent_id, userId)) {
    throw new Error('Insufficient permissions');
  }
  db.prepare(
    'UPDATE authored_skills SET template = ?, version = version + 1, updated_at = datetime("now") WHERE id = ?'
  ).run(template, id);
  logger.info('Authored skill template updated', { id, version: skill.version + 1 });
}

// ── AI Code Generation ──

async function generateToolCode(
  taskDescription: string,
  agentName: string
): Promise<{ spec: ToolSpec; code: string }> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: `You are a tool-authoring assistant for an AI agent named "${agentName}".
Generate a self-contained tool that can be executed in a sandboxed Docker container.

Return ONLY valid JSON with this schema:
{
  "name": "tool-name-kebab-case",
  "description": "What the tool does",
  "language": "javascript",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [...]
  },
  "code": "// Self-contained script that reads INPUT env var as JSON, does work, writes result to stdout"
}

Rules:
- Name must be kebab-case, 3-40 chars
- Code must be self-contained (no external packages beyond Node.js stdlib or Python stdlib)
- Code reads input from INPUT env var (JSON string) and prints result to stdout
- No network calls unless explicitly needed for the tool's purpose
- No file system writes outside /tmp
- Keep code under 200 lines
- Language must be "javascript", "python", or "bash"`,
      messages: [{
        role: 'user',
        content: `Create a tool for this purpose: ${taskDescription}`,
      }],
    });

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI did not return valid JSON');

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      spec: {
        name: parsed.name,
        description: parsed.description,
        inputSchema: parsed.inputSchema || { type: 'object', properties: {} },
        language: parsed.language || 'javascript',
      },
      code: parsed.code,
    };
  } catch (err: any) {
    logger.error('AI tool generation failed', { error: err.message });
    throw new Error(`Failed to generate tool: ${err.message}`);
  }
}

async function generateSkillTemplate(
  taskDescription: string,
  agentName: string
): Promise<{ name: string; description: string; template: string }> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You author reusable prompt template skills for AI agent "${agentName}".
Return ONLY valid JSON:
{
  "name": "skill-name-kebab-case",
  "description": "What this skill does",
  "template": "The prompt template with {{variable}} placeholders"
}
Keep templates focused, under 500 words. Use {{placeholders}} for dynamic values.`,
      messages: [{
        role: 'user',
        content: `Create a reusable skill template for: ${taskDescription}`,
      }],
    });

    const text = response.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI did not return valid JSON');

    return JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    logger.error('AI skill generation failed', { error: err.message });
    throw new Error(`Failed to generate skill: ${err.message}`);
  }
}

// ── Code Validation ──

const FORBIDDEN_PATTERNS = [
  /process\.exit/i,
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /exec\s*\(/,
  /spawn\s*\(/,
  /eval\s*\(/,
  /Function\s*\(/,
  /rm\s+-rf\s+\//,
  /:(){ :|:& };:/,  // fork bomb
];

function validateToolCode(code: string, language: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) {
      throw new Error(`Tool code contains forbidden pattern: ${pattern.source}`);
    }
  }

  if (code.length > 50000) {
    throw new Error('Tool code exceeds maximum size (50KB)');
  }

  if (code.split('\n').length > 500) {
    throw new Error('Tool code exceeds maximum line count (500 lines)');
  }
}

// ── Execute Authored Tool in Sandbox ──

export function getToolExecutionScript(toolName: string): string | null {
  const tool = getCustomTool(toolName);
  if (!tool?.script_code || !tool.approved) return null;

  // Wrap in a sandboxed runner
  switch (tool.language) {
    case 'javascript':
      return `#!/usr/bin/env node
'use strict';
const input = JSON.parse(process.env.INPUT || '{}');
// ── Agent-authored tool: ${toolName} ──
${tool.script_code}
`;
    case 'python':
      return `#!/usr/bin/env python3
import os, json, sys
input_data = json.loads(os.environ.get('INPUT', '{}'))
# ── Agent-authored tool: ${toolName} ──
${tool.script_code}
`;
    case 'bash':
      return `#!/usr/bin/env bash
set -euo pipefail
INPUT="$\{INPUT:-'{}'}"
# ── Agent-authored tool: ${toolName} ──
${tool.script_code}
`;
    default:
      return null;
  }
}
