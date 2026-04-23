import type { Tool } from '@anthropic-ai/sdk/resources/messages';
import { getAgent, listAgents } from '../agents';
import { getRunRecord, getRunsByAgent, getRunToolCalls, getRunTrace } from '../execution';
import { getAgentMemories } from '../sources/memory';
import { getAgentErrorRates } from '../observability';
import { getAuditLog } from '../audit';
import { getAgentTriggers } from '../triggers';
import { getCustomTool } from '../tools';
import { getToolAnalytics } from '../self-authoring';
import { getIntegration, getIntegrations } from '../tools/integrations';
import type { Agent, RunRecord, ToolCallRecord } from '../../types';
import { friendlyModel, friendlyRunStatus } from '../../utils/labels';

// ── Friendly label helpers ──

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  'serpapi-read': 'Web Search',
  'kb-search': 'Knowledge Base',
  'chargebee-read': 'Chargebee', 'chargebee-write': 'Chargebee',
  'hubspot-read': 'HubSpot', 'hubspot-write': 'HubSpot',
  'linear-read': 'Linear', 'linear-write': 'Linear',
  'zendesk-read': 'Zendesk', 'zendesk-write': 'Zendesk',
  'posthog-read': 'PostHog',
  'google-drive-read': 'Google Drive', 'google-drive-write': 'Google Drive',
  'google-sheets-read': 'Google Sheets', 'google-sheets-write': 'Google Sheets',
  'google-docs-read': 'Google Docs', 'google-docs-write': 'Google Docs',
  'gmail-read': 'Gmail', 'gmail-write': 'Gmail',
};

function friendlyToolName(name: string): string {
  return TOOL_FRIENDLY_NAMES[name] || name.replace(/-read$/, '').replace(/-write$/, '').replace(/-search$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const friendlyStatus = friendlyRunStatus;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function summarizeAgent(agent: Agent): Record<string, unknown> {
  const tools = (agent.tools || []).map(friendlyToolName);
  const uniqueTools = [...new Set(tools)];
  return {
    name: agent.name,
    status: agent.status === 'active' ? 'Active' : agent.status,
    model: friendlyModel(agent.model),
    tools: uniqueTools.length > 0 ? uniqueTools : 'None',
    memoryEnabled: agent.memory_enabled ? 'Yes' : 'No',
    responseMode: agent.mentions_only ? 'Only when @mentioned' : agent.respond_to_all_messages ? 'Every message' : 'Relevant messages',
    effortLevel: agent.max_turns <= 10 ? 'Quick' : agent.max_turns <= 25 ? 'Standard' : agent.max_turns <= 50 ? 'Thorough' : 'Maximum',
    writePolicy: agent.write_policy === 'auto' ? 'Automatic' : agent.write_policy === 'confirm' ? 'Asks user first' : 'Asks owner/admins first',
    instructionsSummary: (agent.system_prompt || '').slice(0, 500) + ((agent.system_prompt || '').length > 500 ? '...' : ''),
  };
}

function summarizeRun(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id,
    status: friendlyStatus(run.status),
    model: friendlyModel(run.model),
    duration: formatDuration(run.duration_ms),
    cost: formatCost(run.estimated_cost_usd),
    toolsUsed: run.tool_calls_count,
    input: (run.input || '').slice(0, 500),
    output: (run.output || '').slice(0, 1000),
    time: run.created_at,
  };
}

function summarizeToolCall(tc: ToolCallRecord): Record<string, unknown> {
  return {
    tool: friendlyToolName(tc.tool_name),
    input: tc.tool_input ? JSON.stringify(tc.tool_input).slice(0, 500) : null,
    output: tc.tool_output ? tc.tool_output.slice(0, 500) : null,
    error: tc.error ? tc.error.slice(0, 500) : null,
    sequence: tc.sequence_number,
  };
}

// ── Tool Definitions ──

export const DIAGNOSTIC_TOOLS: Tool[] = [
  {
    name: 'get_agent_config',
    description: 'Get full configuration of an agent including instructions, model, tools, and settings. Use when you need to understand how an agent is set up.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_recent_runs',
    description: 'Get recent execution runs for an agent. Use to check recent activity, find errors, or see performance trends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
        status_filter: { type: 'string', enum: ['all', 'completed', 'failed', 'timeout'], description: 'Filter by status. Default: all' },
        limit: { type: 'number', description: 'Max runs to return (1-20). Default: 10' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_run_detail',
    description: 'Get full details of a specific run including input, output, token usage, and cost.',
    input_schema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string', description: 'The run ID' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'get_run_tool_calls',
    description: 'Get the individual tool calls made during a specific run, including what inputs were passed and what each tool returned. Critical for diagnosing tool-related failures.',
    input_schema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string', description: 'The run ID' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'get_run_trace',
    description: 'Get the full conversation trace from a run (raw JSONL events). Use only when you need the complete step-by-step execution flow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string', description: 'The run ID' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'get_tool_code',
    description: 'Get the actual code and schema of a tool. Use when you need to understand what a tool can and cannot do, or diagnose why a tool returned unexpected results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: { type: 'string', description: 'The tool name (e.g., "hubspot-read")' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'get_tool_analytics',
    description: 'Get usage statistics for a tool including success rate, average duration, and last error.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: { type: 'string', description: 'The tool name' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'get_agent_memories',
    description: 'Get facts and patterns the agent has learned across conversations. Useful to check if the agent has learned incorrect information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_agent_triggers',
    description: 'Get trigger configurations for an agent (scheduled runs, webhook triggers, event-based triggers).',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'The agent ID' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'get_error_rates',
    description: 'Get error rates for all agents in the workspace. Use to identify which agents are having the most problems.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_audit_log',
    description: 'Get recent audit log entries showing configuration changes, tool invocations, and other actions. Use to see what changed recently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'Optional: filter to a specific agent' },
        limit: { type: 'number', description: 'Max entries (1-50). Default: 20' },
      },
    },
  },
  {
    name: 'list_agents',
    description: 'List all agents in the workspace with their names and basic info.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'propose_agent_changes',
    description: 'Propose configuration changes to an agent. Returns a structured diff that the user can review and apply. Use when the user asks to change agent settings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_id: { type: 'string', description: 'The agent ID to modify' },
        changes: {
          type: 'object',
          description: 'Key-value pairs of fields to change. Valid fields: name, systemPrompt, model (opus/sonnet/haiku), memoryEnabled (boolean), respondToAllMessages (boolean), mentionsOnly (boolean), maxTurns (number), writePolicy (auto/confirm/admin_confirm), tools (array of tool names)',
        },
      },
      required: ['agent_id', 'changes'],
    },
  },
];

// ── Tool Execution Handlers ──

export type ToolResult = { content: string; is_error?: boolean };

// Friendly labels for tool_call status messages shown to the user
export const TOOL_CALL_LABELS: Record<string, string> = {
  get_agent_config: 'Looking up agent settings...',
  get_recent_runs: 'Checking recent activity...',
  get_run_detail: 'Reading run details...',
  get_run_tool_calls: 'Inspecting tool calls...',
  get_run_trace: 'Reading execution trace...',
  get_tool_code: 'Reading tool code...',
  get_tool_analytics: 'Checking tool performance...',
  get_agent_memories: 'Reviewing agent memories...',
  get_agent_triggers: 'Checking triggers...',
  get_error_rates: 'Checking error rates...',
  get_audit_log: 'Reviewing recent changes...',
  list_agents: 'Listing agents...',
  propose_agent_changes: 'Preparing changes...',
};

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  workspaceId: string,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'get_agent_config': {
        const agent = await getAgent(workspaceId, input.agent_id as string);
        if (!agent) return { content: 'Agent not found.', is_error: true };
        return { content: JSON.stringify(summarizeAgent(agent)) };
      }

      case 'get_recent_runs': {
        const limit = Math.min(Math.max((input.limit as number) || 10, 1), 20);
        const runs = await getRunsByAgent(workspaceId, input.agent_id as string, limit);
        const statusFilter = input.status_filter as string;
        const filtered = statusFilter && statusFilter !== 'all'
          ? runs.filter(r => r.status === statusFilter)
          : runs;
        if (filtered.length === 0) return { content: 'No runs found.' };
        return { content: JSON.stringify(filtered.map(summarizeRun)) };
      }

      case 'get_run_detail': {
        const run = await getRunRecord(workspaceId, input.run_id as string);
        if (!run) return { content: 'Run not found.', is_error: true };
        return { content: JSON.stringify(summarizeRun(run)) };
      }

      case 'get_run_tool_calls': {
        const toolCalls = await getRunToolCalls(workspaceId, input.run_id as string);
        if (toolCalls.length === 0) return { content: 'No tool calls recorded for this run.' };
        return { content: JSON.stringify(toolCalls.map(summarizeToolCall)) };
      }

      case 'get_run_trace': {
        const trace = await getRunTrace(workspaceId, input.run_id as string);
        if (!trace) return { content: 'No trace available for this run.' };
        // Return last 20 events to stay within token budget
        const lines = trace.split('\n').filter(l => l.trim());
        const lastEvents = lines.slice(-20);
        return { content: lastEvents.join('\n') };
      }

      case 'get_tool_code': {
        const toolName2 = input.tool_name as string;
        // Try custom tool first
        const customTool = await getCustomTool(workspaceId, toolName2);
        if (customTool) {
          return {
            content: JSON.stringify({
              name: friendlyToolName(customTool.name),
              type: 'Custom tool',
              schema: customTool.schema_json ? JSON.parse(customTool.schema_json) : null,
              code: (customTool.script_code || '').slice(0, 3000),
              language: customTool.language,
              accessLevel: customTool.access_level === 'read-write' ? 'Can view & edit data' : 'Can view data',
            }),
          };
        }
        // Try integration tool
        const baseName = toolName2.replace(/-read$/, '').replace(/-write$/, '').replace(/-search$/, '');
        const integration = getIntegration(baseName);
        if (integration) {
          const toolDef = integration.tools.find(t => t.name === toolName2);
          if (toolDef) {
            return {
              content: JSON.stringify({
                name: friendlyToolName(toolDef.name),
                type: `${integration.label} integration`,
                schema: JSON.parse(toolDef.schema),
                code: toolDef.code.slice(0, 3000),
                accessLevel: toolDef.accessLevel === 'read-write' ? 'Can view & edit data' : 'Can view data',
              }),
            };
          }
        }
        return { content: `Tool "${friendlyToolName(toolName2)}" not found.`, is_error: true };
      }

      case 'get_tool_analytics': {
        const analytics = await getToolAnalytics(workspaceId, input.tool_name as string);
        return {
          content: JSON.stringify({
            tool: friendlyToolName(input.tool_name as string),
            totalRuns: analytics.totalRuns,
            successRate: `${Math.round(analytics.successRate * 100)}%`,
            avgDuration: formatDuration(analytics.avgDurationMs),
            lastUsed: analytics.lastUsed || 'Never',
            lastError: analytics.lastError || 'None',
          }),
        };
      }

      case 'get_agent_memories': {
        const memories = await getAgentMemories(workspaceId, input.agent_id as string);
        if (memories.length === 0) return { content: 'This agent has no stored memories.' };
        const summarized = memories.slice(0, 30).map(m => ({
          fact: m.fact,
          category: m.category,
          learnedAt: m.created_at,
        }));
        return { content: JSON.stringify(summarized) };
      }

      case 'get_agent_triggers': {
        const triggers = await getAgentTriggers(workspaceId, input.agent_id as string);
        if (triggers.length === 0) return { content: 'No triggers configured for this agent.' };
        const summarized = triggers.map(t => {
          const config = typeof t.config_json === 'string' ? JSON.parse(t.config_json) : t.config_json;
          return {
            type: t.trigger_type === 'slack_channel' ? 'Slack channel' : t.trigger_type === 'schedule' ? 'Scheduled' : t.trigger_type.charAt(0).toUpperCase() + t.trigger_type.slice(1),
            status: t.status === 'active' ? 'Active' : 'Paused',
            config,
          };
        });
        return { content: JSON.stringify(summarized) };
      }

      case 'get_error_rates': {
        const rates = await getAgentErrorRates(workspaceId);
        if (rates.length === 0) return { content: 'No agents with recent activity.' };
        const summarized = rates.map(r => ({
          agent: r.name,
          errorRate: `${Math.round(r.errorRate * 100)}%`,
          totalRuns: r.total,
        }));
        return { content: JSON.stringify(summarized) };
      }

      case 'get_audit_log': {
        const limit = Math.min(Math.max((input.limit as number) || 20, 1), 50);
        const entries = await getAuditLog(workspaceId, {
          agentId: input.agent_id as string | undefined,
          limit,
        });
        if (entries.length === 0) return { content: 'No recent activity in the audit log.' };
        const summarized = entries.slice(0, limit).map((e: any) => ({
          action: e.action_type,
          agent: e.agent_name || undefined,
          tool: e.tool_name ? friendlyToolName(e.tool_name) : undefined,
          status: e.status === 'success' ? 'Completed' : 'Failed',
          error: e.error_message || undefined,
          time: e.timestamp,
        }));
        return { content: JSON.stringify(summarized) };
      }

      case 'list_agents': {
        const agents = await listAgents(workspaceId);
        const summarized = agents.map(a => ({
          id: a.id,
          name: a.name,
          status: a.status === 'active' ? 'Active' : a.status,
          model: friendlyModel(a.model),
          toolCount: (a.tools || []).length,
        }));
        return { content: JSON.stringify(summarized) };
      }

      case 'propose_agent_changes': {
        const agent = await getAgent(workspaceId, input.agent_id as string);
        if (!agent) return { content: 'Agent not found.', is_error: true };
        const changes = input.changes as Record<string, unknown>;
        const proposedChanges: Record<string, { from: unknown; to: unknown }> = {};

        const fieldMap: Record<string, keyof Agent> = {
          name: 'name',
          systemPrompt: 'system_prompt',
          model: 'model',
          memoryEnabled: 'memory_enabled',
          respondToAllMessages: 'respond_to_all_messages',
          mentionsOnly: 'mentions_only',
          maxTurns: 'max_turns',
          writePolicy: 'write_policy',
          tools: 'tools',
        };

        for (const [key, newValue] of Object.entries(changes)) {
          const agentKey = fieldMap[key];
          if (agentKey) {
            const currentValue = agent[agentKey];
            if (JSON.stringify(currentValue) !== JSON.stringify(newValue)) {
              proposedChanges[key] = { from: currentValue, to: newValue };
            }
          }
        }

        if (Object.keys(proposedChanges).length === 0) {
          return { content: JSON.stringify({ message: 'No changes needed — agent is already configured this way.', proposedChanges: null }) };
        }

        return {
          content: JSON.stringify({
            message: `${Object.keys(proposedChanges).length} change(s) proposed for "${agent.name}".`,
            proposedChanges,
            agentId: agent.id,
          }),
        };
      }

      default:
        return { content: `Unknown tool: ${toolName}`, is_error: true };
    }
  } catch (err: any) {
    return { content: `Error: ${err.message || 'Unknown error'}`, is_error: true };
  }
}
