import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { canModifyAgent } from '../access-control';
import type { CustomTool, ToolType, ToolAccessLevel } from '../../types';
import { logger } from '../../utils/logger';

// ── Built-in Tools ──

const BUILTIN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'NotebookEdit', 'TodoWrite', 'Agent', 'Mcp',
];

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.includes(name);
}

export function getBuiltinTools(): string[] {
  return [...BUILTIN_TOOLS];
}

// ── Tool Management ──

export async function addToolToAgent(
  agentId: string,
  toolName: string,
  userId: string
): Promise<string[]> {
  if (!(await canModifyAgent(agentId, userId))) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = [...agent.tools];
  if (tools.includes(toolName)) {
    return tools; // Already has this tool
  }

  // Verify tool exists
  if (!isBuiltinTool(toolName)) {
    const custom = await getCustomTool(toolName);
    if (!custom) throw new Error(`Tool "${toolName}" not found`);
  }

  tools.push(toolName);
  await updateAgent(agentId, { tools }, userId);

  logger.info('Tool added to agent', { agentId, toolName, userId });
  return tools;
}

export async function removeToolFromAgent(
  agentId: string,
  toolName: string,
  userId: string
): Promise<string[]> {
  if (!(await canModifyAgent(agentId, userId))) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = agent.tools.filter(t => t !== toolName);
  await updateAgent(agentId, { tools }, userId);

  logger.info('Tool removed from agent', { agentId, toolName, userId });
  return tools;
}

// ── Custom Tools ──
// NOTE: Custom tools are created by admins via code only — not via Slack.

export async function registerCustomTool(
  name: string,
  schemaJson: string,
  scriptPathOrCode: string | null,
  registeredBy: string,
  options?: {
    code?: string;
    language?: 'javascript' | 'python' | 'bash';
    autoApprove?: boolean;
    accessLevel?: ToolAccessLevel;
    configJson?: string;
  }
): Promise<CustomTool> {
  const id = uuid();

  const existing = await queryOne('SELECT id FROM custom_tools WHERE name = $1', [name]);
  if (existing) throw new Error(`Tool "${name}" already registered`);

  const scriptCode = options?.code || null;
  const language = options?.language || 'javascript';
  const approved = options?.autoApprove ?? true;
  const accessLevel = options?.accessLevel || 'read-only';
  const configJson = options?.configJson || '{}';

  const tool: CustomTool = {
    id,
    name,
    tool_type: 'custom',
    schema_json: schemaJson,
    script_code: scriptCode,
    script_path: scriptCode ? null : scriptPathOrCode,
    language,
    registered_by: registeredBy,
    approved,
    access_level: accessLevel,
    config_json: configJson,
    created_at: new Date().toISOString(),
  };

  await execute(`
    INSERT INTO custom_tools (id, name, tool_type, schema_json, script_code, script_path, language, registered_by, approved, access_level, config_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [tool.id, tool.name, tool.tool_type, tool.schema_json,
    tool.script_code, tool.script_path, tool.language, tool.registered_by,
    tool.approved, tool.access_level, tool.config_json, tool.created_at]);

  logger.info('Custom tool registered', { toolId: id, name, registeredBy, approved, accessLevel, language });
  return tool;
}

export async function approveCustomTool(name: string, userId: string): Promise<void> {
  const isSuperadmin = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadmin) throw new Error('Only admins can approve tools');

  await execute('UPDATE custom_tools SET approved = TRUE WHERE name = $1', [name]);
  logger.info('Custom tool approved', { name, userId });
}

export async function getToolCode(name: string): Promise<{ code: string; language: string } | null> {
  const tool = await getCustomTool(name);
  if (!tool || !tool.script_code) return null;
  return { code: tool.script_code, language: tool.language };
}

export async function getCustomTool(name: string): Promise<CustomTool | null> {
  const row = await queryOne<CustomTool>('SELECT * FROM custom_tools WHERE name = $1', [name]);
  return row || null;
}

export async function listCustomTools(): Promise<CustomTool[]> {
  return query<CustomTool>('SELECT * FROM custom_tools ORDER BY name');
}

/**
 * List only approved read-only custom tools — safe for user-created agents.
 */
export async function listUserAvailableTools(): Promise<CustomTool[]> {
  return query<CustomTool>(
    `SELECT * FROM custom_tools WHERE approved = TRUE AND access_level = 'read-only' ORDER BY name`
  );
}

/**
 * List approved read-write custom tools — requires admin approval to attach.
 */
export async function listWriteTools(): Promise<CustomTool[]> {
  return query<CustomTool>(
    `SELECT * FROM custom_tools WHERE approved = TRUE AND access_level = 'read-write' ORDER BY name`
  );
}

export async function deleteCustomTool(name: string, userId: string): Promise<void> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) {
    throw new Error('Only admins can delete custom tools');
  }

  await execute('DELETE FROM custom_tools WHERE name = $1', [name]);
  logger.info('Custom tool deleted', { name, userId });
}

// ── Tool Config & Access Level Management (admin only) ──

export async function updateToolConfig(
  name: string,
  configJson: string,
  userId: string,
): Promise<void> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE name = $2', [configJson, name]);
  logger.info('Tool config updated', { name, userId });
}

export async function setToolConfigKey(
  name: string,
  key: string,
  value: string,
  userId: string,
): Promise<Record<string, any>> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  const config = JSON.parse(tool.config_json || '{}');
  config[key] = value;
  const newConfigJson = JSON.stringify(config);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE name = $2', [newConfigJson, name]);
  logger.info('Tool config key set', { name, key, userId });
  return config;
}

export async function removeToolConfigKey(
  name: string,
  key: string,
  userId: string,
): Promise<Record<string, any>> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  const config = JSON.parse(tool.config_json || '{}');
  delete config[key];
  const newConfigJson = JSON.stringify(config);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE name = $2', [newConfigJson, name]);
  logger.info('Tool config key removed', { name, key, userId });
  return config;
}

export async function getToolConfig(
  name: string,
  userId: string,
): Promise<Record<string, any>> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) throw new Error('Only admins can view tool config');

  const tool = await getCustomTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  return JSON.parse(tool.config_json || '{}');
}

export async function updateToolAccessLevel(
  name: string,
  accessLevel: ToolAccessLevel,
  userId: string,
): Promise<void> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) throw new Error('Only admins can change tool access level');

  const tool = await getCustomTool(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  await execute('UPDATE custom_tools SET access_level = $1 WHERE name = $2', [accessLevel, name]);
  logger.info('Tool access level updated', { name, accessLevel, userId });
}

// ── Agent Tool Summary ──

export async function getAgentToolSummary(agentId: string): Promise<{
  builtin: string[];
  custom: string[];
  mcp: string[];
}> {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const builtin: string[] = [];
  const custom: string[] = [];
  const mcp: string[] = [];

  for (const tool of agent.tools) {
    if (isBuiltinTool(tool)) {
      builtin.push(tool);
    } else {
      const customTool = await getCustomTool(tool);
      if (customTool) {
        custom.push(tool);
      } else {
        mcp.push(tool);
      }
    }
  }

  return { builtin, custom, mcp };
}
