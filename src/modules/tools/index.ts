import { v4 as uuid } from 'uuid';
import { getDb } from '../../db';
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

export function addToolToAgent(
  agentId: string,
  toolName: string,
  userId: string
): string[] {
  if (!canModifyAgent(agentId, userId)) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = [...agent.tools];
  if (tools.includes(toolName)) {
    return tools; // Already has this tool
  }

  // Verify tool exists
  if (!isBuiltinTool(toolName)) {
    const custom = getCustomTool(toolName);
    if (!custom) throw new Error(`Tool "${toolName}" not found`);
  }

  tools.push(toolName);
  updateAgent(agentId, { tools }, userId);

  logger.info('Tool added to agent', { agentId, toolName, userId });
  return tools;
}

export function removeToolFromAgent(
  agentId: string,
  toolName: string,
  userId: string
): string[] {
  if (!canModifyAgent(agentId, userId)) {
    throw new Error('Insufficient permissions to modify agent tools');
  }

  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const tools = agent.tools.filter(t => t !== toolName);
  updateAgent(agentId, { tools }, userId);

  logger.info('Tool removed from agent', { agentId, toolName, userId });
  return tools;
}

// ── Custom Tools ──

export function registerCustomTool(
  name: string,
  schemaJson: string,
  scriptPathOrCode: string | null,
  registeredBy: string,
  options?: { code?: string; language?: 'javascript' | 'python' | 'bash'; autoApprove?: boolean }
): CustomTool {
  const db = getDb();
  const id = uuid();

  // Admins or agent self-authoring (agent IDs are UUIDs)
  const isSuperadminRow = db.prepare('SELECT user_id FROM superadmins WHERE user_id = ?').get(registeredBy);
  const isAgentAuthored = !isSuperadminRow;

  const existing = db.prepare('SELECT id FROM custom_tools WHERE name = ?').get(name);
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

  db.prepare(`
    INSERT INTO custom_tools (id, name, tool_type, schema_json, script_code, script_path, language, registered_by, approved, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tool.id, tool.name, tool.tool_type, tool.schema_json,
    tool.script_code, tool.script_path, tool.language, tool.registered_by,
    tool.approved ? 1 : 0, tool.created_at);

  logger.info('Custom tool registered', { toolId: id, name, registeredBy, approved, language });
  return tool;
}

export function approveCustomTool(name: string, userId: string): void {
  const db = getDb();
  const isSuperadmin = db.prepare('SELECT user_id FROM superadmins WHERE user_id = ?').get(userId);
  if (!isSuperadmin) throw new Error('Only admins can approve tools');

  db.prepare('UPDATE custom_tools SET approved = 1 WHERE name = ?').run(name);
  logger.info('Custom tool approved', { name, userId });
}

export function getToolCode(name: string): { code: string; language: string } | null {
  const tool = getCustomTool(name);
  if (!tool || !tool.script_code) return null;
  return { code: tool.script_code, language: tool.language };
}

export function getCustomTool(name: string): CustomTool | null {
  const db = getDb();
  return db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(name) as CustomTool | null;
}

export function listCustomTools(): CustomTool[] {
  const db = getDb();
  return db.prepare('SELECT * FROM custom_tools ORDER BY name').all() as CustomTool[];
}

export function deleteCustomTool(name: string, userId: string): void {
  const db = getDb();
  const isSuperadminRow = db.prepare('SELECT user_id FROM superadmins WHERE user_id = ?').get(userId);
  if (!isSuperadminRow) {
    throw new Error('Only admins can delete custom tools');
  }

  db.prepare('DELETE FROM custom_tools WHERE name = ?').run(name);
  logger.info('Custom tool deleted', { name, userId });
}

// ── Agent Tool Summary ──

export function getAgentToolSummary(agentId: string): {
  builtin: string[];
  custom: string[];
  mcp: string[];
} {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const builtin: string[] = [];
  const custom: string[] = [];
  const mcp: string[] = [];

  for (const tool of agent.tools) {
    if (isBuiltinTool(tool)) {
      builtin.push(tool);
    } else {
      const customTool = getCustomTool(tool);
      if (customTool) {
        custom.push(tool);
      } else {
        mcp.push(tool);
      }
    }
  }

  return { builtin, custom, mcp };
}
