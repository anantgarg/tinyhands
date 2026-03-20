import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { canModifyAgent, isPlatformAdmin } from '../access-control';
import type { CustomTool, ToolType, ToolAccessLevel } from '../../types';
import { logger } from '../../utils/logger';

// ── Built-in Tools ──
// Core tools are always available to every agent — they don't need to be
// added/removed. They're part of the Docker image and Claude SDK.
const CORE_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
];

// Legacy builtin names for backward compatibility checks
const LEGACY_BUILTIN_NAMES = new Set([
  ...CORE_TOOLS, 'NotebookEdit', 'TodoWrite', 'Agent', 'Mcp',
]);

export function isBuiltinTool(name: string): boolean {
  return LEGACY_BUILTIN_NAMES.has(name);
}

export function isCoreAlwaysOnTool(name: string): boolean {
  return CORE_TOOLS.includes(name);
}

export function getBuiltinTools(): string[] {
  return [...CORE_TOOLS];
}

// ── Tool Management ──

export async function addToolToAgent(
  workspaceId: string,
  agentId: string,
  toolName: string,
  userId: string
): Promise<string[]> {
  if (!(await canModifyAgent(workspaceId, agentId, userId))) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = [...agent.tools];
  if (tools.includes(toolName)) {
    return tools; // Already has this tool
  }

  // Core tools are always available — don't add them to the array
  if (isCoreAlwaysOnTool(toolName)) {
    return tools;
  }

  // Verify tool exists (check custom tools DB or integration manifests)
  if (!isBuiltinTool(toolName)) {
    const custom = await getCustomTool(workspaceId, toolName);
    if (!custom) {
      // Also check integration manifests — tool may exist in a manifest but not yet registered in DB
      const { getIntegrations } = await import('./integrations');
      const manifests = getIntegrations();
      const inManifest = manifests.some(m => m.tools.some((t: any) => t.name === toolName));
      if (!inManifest) throw new Error(`Tool "${toolName}" not found`);
    }
  }

  tools.push(toolName);
  await updateAgent(workspaceId, agentId, { tools }, userId);

  logger.info('Tool added to agent', { agentId, toolName, userId });
  return tools;
}

export async function removeToolFromAgent(
  workspaceId: string,
  agentId: string,
  toolName: string,
  userId: string
): Promise<string[]> {
  if (!(await canModifyAgent(workspaceId, agentId, userId))) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = agent.tools.filter(t => t !== toolName);
  await updateAgent(workspaceId, agentId, { tools }, userId);

  logger.info('Tool removed from agent', { agentId, toolName, userId });
  return tools;
}

// ── Custom Tools ──
// NOTE: Custom tools are created by admins via code only — not via Slack.

export async function registerCustomTool(
  workspaceId: string,
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

  const existing = await queryOne('SELECT id FROM custom_tools WHERE workspace_id = $1 AND name = $2', [workspaceId, name]);
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
    INSERT INTO custom_tools (id, workspace_id, name, tool_type, schema_json, script_code, script_path, language, registered_by, approved, access_level, config_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  `, [tool.id, workspaceId, tool.name, tool.tool_type, tool.schema_json,
    tool.script_code, tool.script_path, tool.language, tool.registered_by,
    tool.approved, tool.access_level, tool.config_json, tool.created_at]);

  logger.info('Custom tool registered', { toolId: id, name, registeredBy, approved, accessLevel, language });
  return tool;
}

export async function approveCustomTool(workspaceId: string, name: string, userId: string): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can approve tools');

  await execute('UPDATE custom_tools SET approved = TRUE WHERE workspace_id = $1 AND name = $2', [workspaceId, name]);
  logger.info('Custom tool approved', { name, userId });
}

export async function getToolCode(workspaceId: string, name: string): Promise<{ code: string; language: string } | null> {
  const tool = await getCustomTool(workspaceId, name);
  if (!tool || !tool.script_code) return null;
  return { code: tool.script_code, language: tool.language };
}

export async function getCustomTool(workspaceId: string, name: string): Promise<CustomTool | null> {
  const row = await queryOne<CustomTool>('SELECT * FROM custom_tools WHERE workspace_id = $1 AND name = $2', [workspaceId, name]);
  return row || null;
}

export async function listCustomTools(workspaceId: string): Promise<CustomTool[]> {
  return query<CustomTool>('SELECT * FROM custom_tools WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
}

/**
 * List only approved read-only custom tools — safe for user-created agents.
 */
export async function listUserAvailableTools(workspaceId: string): Promise<CustomTool[]> {
  return query<CustomTool>(
    `SELECT * FROM custom_tools WHERE workspace_id = $1 AND approved = TRUE AND access_level = 'read-only' ORDER BY name`,
    [workspaceId]
  );
}

/**
 * List approved read-write custom tools — requires admin approval to attach.
 */
export async function listWriteTools(workspaceId: string): Promise<CustomTool[]> {
  return query<CustomTool>(
    `SELECT * FROM custom_tools WHERE workspace_id = $1 AND approved = TRUE AND access_level = 'read-write' ORDER BY name`,
    [workspaceId]
  );
}

export async function deleteCustomTool(workspaceId: string, name: string, userId: string): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, userId))) {
    throw new Error('Only admins can delete custom tools');
  }

  await execute('DELETE FROM custom_tools WHERE workspace_id = $1 AND name = $2', [workspaceId, name]);
  logger.info('Custom tool deleted', { name, userId });
}

// ── Tool Config & Access Level Management (admin only) ──

export async function updateToolConfig(
  workspaceId: string,
  name: string,
  configJson: string,
  userId: string,
): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(workspaceId, name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = $3', [configJson, workspaceId, name]);
  logger.info('Tool config updated', { name, userId });
}

export async function setToolConfigKey(
  workspaceId: string,
  name: string,
  key: string,
  value: string,
  userId: string,
): Promise<Record<string, any>> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(workspaceId, name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  const config = JSON.parse(tool.config_json || '{}');
  config[key] = value;
  const newConfigJson = JSON.stringify(config);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = $3', [newConfigJson, workspaceId, name]);
  logger.info('Tool config key set', { name, key, userId });
  return config;
}

export async function removeToolConfigKey(
  workspaceId: string,
  name: string,
  key: string,
  userId: string,
): Promise<Record<string, any>> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can update tool config');

  const tool = await getCustomTool(workspaceId, name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  const config = JSON.parse(tool.config_json || '{}');
  delete config[key];
  const newConfigJson = JSON.stringify(config);

  await execute('UPDATE custom_tools SET config_json = $1 WHERE workspace_id = $2 AND name = $3', [newConfigJson, workspaceId, name]);
  logger.info('Tool config key removed', { name, key, userId });
  return config;
}

export async function getToolConfig(
  workspaceId: string,
  name: string,
  userId: string,
): Promise<Record<string, any>> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can view tool config');

  const tool = await getCustomTool(workspaceId, name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  return JSON.parse(tool.config_json || '{}');
}

export async function updateToolAccessLevel(
  workspaceId: string,
  name: string,
  accessLevel: ToolAccessLevel,
  userId: string,
): Promise<void> {
  if (!(await isPlatformAdmin(workspaceId, userId))) throw new Error('Only admins can change tool access level');

  const tool = await getCustomTool(workspaceId, name);
  if (!tool) throw new Error(`Tool "${name}" not found`);

  await execute('UPDATE custom_tools SET access_level = $1 WHERE workspace_id = $2 AND name = $3', [accessLevel, workspaceId, name]);
  logger.info('Tool access level updated', { name, accessLevel, userId });
}

// ── Agent Tool Summary ──

export async function getAgentToolSummary(workspaceId: string, agentId: string): Promise<{
  builtin: string[];
  custom: string[];
  mcp: string[];
}> {
  const agent = await getAgent(workspaceId, agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const builtin: string[] = [];
  const custom: string[] = [];
  const mcp: string[] = [];

  for (const tool of agent.tools) {
    if (isBuiltinTool(tool)) {
      builtin.push(tool);
    } else {
      const customTool = await getCustomTool(workspaceId, tool);
      if (customTool) {
        custom.push(tool);
      } else {
        mcp.push(tool);
      }
    }
  }

  return { builtin, custom, mcp };
}
