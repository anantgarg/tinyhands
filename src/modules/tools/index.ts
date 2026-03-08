import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import { getAgent, updateAgent } from '../agents';
import { canModifyAgent } from '../access-control';
import type { CustomTool, ToolType } from '../../types';
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

export async function registerCustomTool(
  name: string,
  schemaJson: string,
  scriptPathOrCode: string | null,
  registeredBy: string,
  options?: { code?: string; language?: 'javascript' | 'python' | 'bash'; autoApprove?: boolean }
): Promise<CustomTool> {
  const id = uuid();

  // Admins or agent self-authoring (agent IDs are UUIDs)
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [registeredBy]);
  const isAgentAuthored = !isSuperadminRow;

  const existing = await queryOne('SELECT id FROM custom_tools WHERE name = $1', [name]);
  if (existing) throw new Error(`Tool "${name}" already registered`);

  const scriptCode = options?.code || null;
  const language = options?.language || 'javascript';
  const approved = options?.autoApprove || !isAgentAuthored;

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
    created_at: new Date().toISOString(),
  };

  await execute(`
    INSERT INTO custom_tools (id, name, tool_type, schema_json, script_code, script_path, language, registered_by, approved, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [tool.id, tool.name, tool.tool_type, tool.schema_json,
    tool.script_code, tool.script_path, tool.language, tool.registered_by,
    tool.approved, tool.created_at]);

  logger.info('Custom tool registered', { toolId: id, name, registeredBy, approved, language });
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

export async function deleteCustomTool(name: string, userId: string): Promise<void> {
  const isSuperadminRow = await queryOne('SELECT user_id FROM superadmins WHERE user_id = $1', [userId]);
  if (!isSuperadminRow) {
    throw new Error('Only admins can delete custom tools');
  }

  await execute('DELETE FROM custom_tools WHERE name = $1', [name]);
  logger.info('Custom tool deleted', { name, userId });
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
