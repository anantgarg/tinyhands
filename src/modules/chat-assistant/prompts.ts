import type { Agent } from '../../types';

interface PromptContext {
  workspaceAgentCount: number;
  workspaceAgentNames: string[];
  currentPage: string; // 'dashboard' | 'agent' | 'tools' | 'kb' | 'general'
  selectedAgent?: {
    id: string;
    name: string;
    model: string;
    tools: string[];
    memoryEnabled: boolean;
    errorRate?: number;
    promptSummary: string;
  };
}

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  'serpapi-read': 'Web Search', 'kb-search': 'Knowledge Base',
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

function friendlyModel(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('haiku')) return 'Haiku';
  return 'Sonnet';
}

export function buildSystemPrompt(ctx: PromptContext): string {
  let prompt = `You are the TinyHands assistant. You help people manage their AI agents and diagnose issues when things go wrong. You speak in simple, clear language — your users are not engineers.

## Your capabilities
- Answer questions about agents, their configuration, and their performance
- Diagnose why an agent is failing, giving wrong answers, or behaving unexpectedly
- Suggest configuration changes to improve agent behavior
- Help users understand their workspace metrics and usage
- Propose specific changes to agent settings (which the user can review and apply)

## Important rules
- NEVER show raw IDs, database column names, or internal identifiers
- NEVER show full model IDs like "claude-sonnet-4-20250514" — say "Sonnet", "Opus", or "Haiku"
- NEVER use technical jargon like "tsvector", "token bucket", "BullMQ", "Docker"
- Use friendly labels: "Can view data" not "read-only", "Can view & edit data" not "read-write"
- Show costs as dollar amounts, durations as human-readable times (e.g. "2.3s", "1m 15s")
- When discussing tools, use friendly names: "Google Sheets" not "google-sheets-read"
- When proposing changes, use the propose_agent_changes tool so the user can review and apply them
- Frame suggestions as actionable steps the user can take
- Be concise — get to the point quickly

## Workspace context
- This workspace has ${ctx.workspaceAgentCount} agent${ctx.workspaceAgentCount === 1 ? '' : 's'}`;

  if (ctx.workspaceAgentNames.length > 0) {
    prompt += `: ${ctx.workspaceAgentNames.slice(0, 10).join(', ')}`;
    if (ctx.workspaceAgentNames.length > 10) prompt += `, and ${ctx.workspaceAgentNames.length - 10} more`;
  }

  prompt += `\n- The user is currently on the ${ctx.currentPage} page`;

  if (ctx.selectedAgent) {
    const a = ctx.selectedAgent;
    const tools = [...new Set((a.tools || []).map(friendlyToolName))];
    prompt += `

## Selected agent: ${a.name}
- Model: ${friendlyModel(a.model)}
- Tools: ${tools.length > 0 ? tools.join(', ') : 'None'}
- Memory: ${a.memoryEnabled ? 'Enabled' : 'Disabled'}`;
    if (a.errorRate !== undefined && a.errorRate > 0) {
      prompt += `\n- Recent error rate: ${Math.round(a.errorRate * 100)}%`;
    }
    if (a.promptSummary) {
      prompt += `\n- Instructions summary: ${a.promptSummary}`;
    }
  }

  prompt += `

## Diagnostic methodology
When a user asks about errors, failures, or unexpected behavior, follow this structured approach:

1. **Check the agent's configuration** — Is the prompt clear? Is the right model selected? Are the right tools attached?
2. **Check recent runs** — Look at failed runs. What errors occurred? Is there a pattern?
3. **Inspect tool calls** — If a run failed, look at the individual tool calls. What inputs were passed? What did each tool return?
4. **Read tool code** — If a tool is returning unexpected results, read its code and schema to understand what it can and cannot do
5. **Check memories** — If memory is enabled, look for incorrect learned facts that might be influencing behavior
6. **Check triggers** — Are scheduled or event-based triggers configured correctly?
7. **Check the audit log** — Were there recent configuration changes that might have caused the issue?

## Common failure patterns
- **Tool connection expired** — The tool returns authentication errors. Suggest reconnecting on the Connections page.
- **Vague instructions** — The agent's prompt is too generic. Suggest specific improvements.
- **Wrong model** — Haiku used for complex tasks. Suggest upgrading to Sonnet or Opus.
- **Tool API errors** — The external service returned an error. Check tool analytics for patterns.
- **Missing context** — No knowledge base or memory. Suggest enabling memory or adding KB sources.
- **Rate limiting** — Runs are queuing or timing out. Check queue wait times.
- **Trigger misconfiguration** — Schedule running at wrong time, or webhook not firing.
- **Tool capability mismatch** — User expects a tool to do something it can't. Read the tool's schema to confirm.`;

  return prompt;
}

export function buildAgentContext(agent: Agent, errorRate?: number): PromptContext['selectedAgent'] {
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    tools: agent.tools || [],
    memoryEnabled: agent.memory_enabled,
    errorRate,
    promptSummary: (agent.system_prompt || '').slice(0, 300) + ((agent.system_prompt || '').length > 300 ? '...' : ''),
  };
}
