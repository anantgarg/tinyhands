import Anthropic from '@anthropic-ai/sdk';
import { getBuiltinTools, listUserAvailableTools, listWriteTools } from '../tools';
import { getIntegrations } from '../tools/integrations';
import { getAvailableSkills } from '../skills';
import { isSuperadmin } from '../access-control';
import { logger } from '../../utils/logger';

export interface GoalAnalysis {
  agent_name: string;
  system_prompt: string;
  tools: string[];
  custom_tools: string[];
  skills: string[];
  model: 'opus' | 'sonnet' | 'haiku';
  memory_enabled: boolean;
  triggers: Array<{
    type: 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook' | 'schedule';
    description: string;
    config: Record<string, any>;
  }>;
  relevance_keywords: string[];
  respond_to_all_messages: boolean;
  mentions_only: boolean;
  new_tools_needed: Array<{ name: string; description: string }>;
  new_skills_needed: Array<{ name: string; description: string }>;
  write_tools_requested: string[];
  credential_modes: Record<string, 'team' | 'delegated' | 'runtime'>;
  feasible: boolean;
  blockers: string[];
  summary: string;
}

export async function analyzeGoal(workspaceId: string, goal: string, existingPrompt?: string, requestingUserId?: string, currentAgentName?: string): Promise<GoalAnalysis> {
  const client = new Anthropic();
  const builtinTools = getBuiltinTools();
  const availableSkills = getAvailableSkills();

  // Determine if requesting user is admin
  const isAdmin = requestingUserId ? await isSuperadmin(workspaceId, requestingUserId) : false;

  // Get available custom tools
  const readOnlyTools = await listUserAvailableTools(workspaceId);
  const writeTools = await listWriteTools(workspaceId);

  const isToolConfigured = (t: { config_json: string }): boolean => {
    const cfg = JSON.parse(t.config_json || '{}');
    return Object.keys(cfg).length > 0;
  };

  const readOnlyToolList = readOnlyTools.map(t => {
    const schema = JSON.parse(t.schema_json || '{}');
    const configStatus = isToolConfigured(t) ? '' : ' (NOT CONFIGURED)';
    return `${t.name} (read-only)${configStatus}: ${schema.description || 'Custom tool'}`;
  });

  const writeToolList = writeTools.map(t => {
    const schema = JSON.parse(t.schema_json || '{}');
    const configStatus = isToolConfigured(t) ? '' : ' (NOT CONFIGURED)';
    return `${t.name} (read-write)${configStatus}: ${schema.description || 'Custom tool'}`;
  });

  const skillList = [
    ...availableSkills.mcp.map(s => `Integration: ${s.name} (${s.capabilities.join(', ')})`),
    ...availableSkills.prompt.map(s => `Prompt: ${s.name} (${s.description})`),
  ];

  // Get ALL integration manifests (connected or not) so the analyzer knows what's possible
  const registeredToolNames = new Set([...readOnlyTools.map(t => t.name), ...writeTools.map(t => t.name)]);
  const unregisteredIntegrations: string[] = [];
  const integrationConnectionModels = new Map<string, string>();
  try {
    const integrations = getIntegrations();
    for (const integ of integrations) {
      if ((integ as any).connectionModel) {
        integrationConnectionModels.set(integ.id, (integ as any).connectionModel);
      }
      for (const tool of (integ as any).tools || []) {
        if (!registeredToolNames.has(tool.name)) {
          const schema = typeof tool.schema === 'string' ? JSON.parse(tool.schema) : tool.schema;
          unregisteredIntegrations.push(`${tool.name} (${tool.accessLevel || 'read-only'}) [NOT CONNECTED — requires OAuth or admin setup]: ${schema.description || integ.description || 'Integration tool'}`);
        }
      }
    }
  } catch { /* integrations module may not be available */ }

  const connectionModelSection = integrationConnectionModels.size > 0
    ? `\nIntegration credential models (determines which credential modes are valid for each integration):
${Array.from(integrationConnectionModels.entries()).map(([id, model]) => `- ${id}: ${model}`).join('\n')}

Credential model rules:
- "team" model: only "team" credential mode is valid (shared org credentials)
- "personal" model: only "delegated" or "runtime" modes are valid (NOT "team")
- "hybrid" model: all modes are valid ("team", "delegated", "runtime")`
    : '';

  const customToolsSection = readOnlyToolList.length > 0 || writeToolList.length > 0 || unregisteredIntegrations.length > 0
    ? `\nAvailable custom tools (read-only, always available):\n${readOnlyToolList.join('\n') || '(none)'}\n\nAvailable custom tools (read-write, requires admin approval):\n${writeToolList.join('\n') || '(none)'}${unregisteredIntegrations.length > 0 ? `\n\nIntegration tools available but NOT YET CONNECTED (admin must connect these first):\n${unregisteredIntegrations.join('\n')}` : ''}`
    : '';

  const userRestrictions = isAdmin
    ? ''
    : `\nIMPORTANT RESTRICTIONS (requesting user is NOT an admin):
- The agent can ONLY use existing tools listed above. Do NOT propose new_tools_needed or new_skills_needed.
- For custom_tools, ONLY include read-only tools. If the goal requires read-write tools, list them in "write_tools_requested" — an admin will need to approve them.
- If the goal requires capabilities that don't exist in available tools, set "feasible" to false and list what's missing in "blockers". The user will be able to submit a feature request.
`;

  const apiPromise = client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: `You are an expert agent architect. Given an agent's goal, you deeply analyze what's needed and produce a complete agent configuration. Think step by step about what the agent needs to accomplish its goal.

Core tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch) are always available to every agent.
Additional integration tools that can be enabled: ${customToolsSection ? 'see below' : 'none'}
${customToolsSection}
Available skills:
${skillList.join('\n')}

Available trigger types: slack_channel, linear, zendesk, intercom, webhook, schedule
Schedule trigger config: { "cron": "0 9 * * *", "timezone": "auto", "description": "Daily at 9am" }
Common cron patterns: hourly "0 * * * *", daily "0 9 * * *", weekly Mon "0 9 * * 1"
When timezone is "auto", system detects from Slack.
${connectionModelSection}
${userRestrictions}

Return ONLY valid JSON matching this schema:
{
  "agent_name": "Short Human Name (max 30 chars, natural title case like 'Sales Helper' or 'Bug Triager')",
  "system_prompt": "A comprehensive system prompt. This is the MOST IMPORTANT part. It must clearly define:\n1. WHO the agent is (role, personality)\n2. WHAT it does (specific tasks, responsibilities)\n3. HOW it behaves (tone, format, decision-making rules)\n4. WHEN it should respond vs stay silent\n5. Its tools and how to use them\n6. Output format preferences (use Slack mrkdwn: *bold*, _italic_, \`code\`, bullet lists with •)\n7. Constraints and limitations\nThe prompt should be detailed enough that the agent knows exactly what to do without further guidance.",
  "tools": ["list", "of", "required", "builtin", "tools"],
  "custom_tools": ["list", "of", "required", "custom", "tool", "names"],
  "skills": ["list", "of", "required", "skill", "names", "from", "available", "ones"],
  "model": "sonnet|opus|haiku",
  "memory_enabled": true/false,
  "triggers": [
    {
      "type": "slack_channel|linear|zendesk|intercom|webhook|schedule",
      "description": "human-readable description of when this triggers",
      "config": {"events": ["..."], "description": "..."}
    }
  ],
  "relevance_keywords": ["keywords", "that", "indicate", "a", "message", "is", "relevant", "to", "this", "agent"],
  "respond_to_all_messages": false,
  "mentions_only": false,
  "new_tools_needed": [{"name": "kebab-case-name", "description": "detailed description of what this tool should do"}],
  "new_skills_needed": [{"name": "kebab-case-name", "description": "detailed description of what this skill template should do"}],
  "write_tools_requested": ["names-of-read-write-custom-tools-the-agent-needs"],
  "credential_modes": {"integration_id": "team|delegated|runtime"},
  "feasible": true,
  "blockers": [],
  "summary": "2-3 sentence explanation of the configuration and why each choice was made. Use friendly credential labels: say 'shared team credentials' for team mode, 'the agent creator\\'s credentials' for delegated mode, and 'each user\\'s own credentials' for runtime mode. Never use the words 'delegated' or 'runtime' — describe the behavior instead."
}

IMPORTANT guidelines:
- The system_prompt is the agent's brain. Make it extremely detailed and specific to the goal. Include explicit instructions about output formatting for Slack (no markdown headers, use *bold* not **bold**, use • for bullets, etc.)
- IMPORTANT: In the system_prompt, always include this instruction: "Never use technical terms like MCP, MCP servers, Claude Code, or API configuration in your responses. If a tool or connection is missing, tell the user to go to the Connections page in the TinyHands dashboard or ask the person who set up this agent. Keep all responses simple and non-technical."
- RESPONSE MODE — there are three modes, choose ONE based on the TRIGGER/SCHEDULE instructions:
  - "every message": set respond_to_all_messages=true, mentions_only=false. Use when the goal requires responding to every single message.
  - "when tagged" / "mentions only": set respond_to_all_messages=false, mentions_only=true. The agent ONLY responds when @mentioned or in thread replies. Use this when the TRIGGER/SCHEDULE says "when tagged", "when mentioned", or "mentions only".
  - "when relevant" (default): set respond_to_all_messages=false, mentions_only=false. The agent auto-responds to relevant messages plus @mentions. Use when the goal implies the agent should proactively help with relevant messages.
- relevance_keywords: list words/phrases that, if present in a message, indicate the agent should process it. Include both obvious keywords and contextual ones. For mentions_only or respond_to_all agents, this can be empty.
- triggers: if the goal mentions reacting to external events (new tickets, issues, PRs, webhooks, messages in other channels), configure appropriate triggers. Leave empty if the agent only responds to direct messages in its channel.
- custom_tools: CAREFULLY review the available custom tools list above and include ANY tool whose description matches the agent's goal. For example, if the goal involves SEO/search rankings include serpapi-read, if it involves knowledge base include kb-search, if it involves support tickets include zendesk-read, etc. Only include read-only tools unless the user is an admin.
- write_tools_requested: if the goal would benefit from read-write custom tools, list their names here. These will require admin approval.
- Always include Read, Glob, Grep for code/content-related agents
- Include Write, Edit, Bash for agents that modify files or run commands
- Include WebSearch, WebFetch for research-heavy agents
- Use opus for complex multi-step reasoning, haiku for simple/fast classification, sonnet for general purpose
- Enable memory for agents that build up context over time
- FEASIBILITY: Set "feasible" to true if the agent can work with existing tools/skills. Set "feasible" to false if the goal requires tools or capabilities that don't exist yet — list specific blockers. If new tools are needed, include them in new_tools_needed so an admin can build them.
- UNCONNECTED INTEGRATIONS: If an integration tool exists but is marked [NOT CONNECTED], the agent CAN use it — but it needs to be connected first via the Connections page in the dashboard. Set "feasible" to true, include the tool in "custom_tools", and add a blocker like "Gmail needs to be connected. Go to the Connections page in the dashboard to set it up." Do NOT say the tool doesn't exist — it does, it just needs to be connected.
- credential_modes: For each integration in custom_tools, recommend a credential mode. Only include integrations that appear in custom_tools or write_tools_requested. Choose based on the agent's purpose:
  - "team": agent monitors or acts on behalf of the whole team (e.g., ticket triage, monitoring dashboards, team-wide reporting). Uses shared org-level credentials.
  - "delegated": agent is personal to the creator and acts on their behalf (e.g., "manage MY email", "track MY tasks"). Uses the creator's own credentials.
  - "runtime": agent acts on behalf of whichever user talks to it (e.g., "send email as the requesting user", "file a ticket as the user"). Each user provides their own credentials.
  Respect the integration's credential model constraints (see above). If a tool has a "team" model, only use "team". If "personal" model, use "delegated" or "runtime". If "hybrid", any mode works.
- SLACK MENTIONS: If the goal references tagging/mentioning/notifying a specific person, use the Slack mention format <@USER_ID> in the system_prompt. The requesting user's Slack ID is provided below — use it when the goal says "tag me", "notify me", "mention me", etc. For other users mentioned by name, include a note in the system_prompt to use <@USER_ID> format and that the admin should configure the correct user ID.`,
    messages: [{
      role: 'user',
      content: (existingPrompt
        ? `Current agent_name: ${currentAgentName || '(unknown)'}\nCurrent system prompt:\n${existingPrompt}\n\nUser's update request:\n${goal}\n\nIMPORTANT: The user may describe a problem, a specific tweak, or a full new goal. If they describe a problem or a small change, make targeted incremental edits to the existing system_prompt — preserve everything that's working and only modify what's needed to address their request. If they provide a completely new goal, generate a fresh prompt. Keep the agent_name "${currentAgentName || ''}" from current config if the user is not explicitly requesting a name change.`
        : `Agent goal:\n${goal}`) + (requestingUserId ? `\n\nRequesting user's Slack ID: ${requestingUserId}` : ''),
    }],
  });

  // 90-second timeout to avoid hanging forever
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Goal analysis timed out after 90 seconds. Please try again.')), 90000),
  );
  const response = await Promise.race([apiPromise, timeoutPromise]);

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse goal analysis response');
  }

  const analysis = JSON.parse(jsonMatch[0]) as GoalAnalysis;

  // Filter out core tools (always available) and validate remaining
  const { isCoreAlwaysOnTool } = await import('../tools');
  analysis.tools = (analysis.tools || []).filter(t => !isCoreAlwaysOnTool(t));

  // Validate custom_tools exist
  if (!analysis.custom_tools) analysis.custom_tools = [];
  const validReadOnlyNames = new Set(readOnlyTools.map(t => t.name));
  const validWriteNames = new Set(writeTools.map(t => t.name));

  if (!isAdmin) {
    // Non-admin: only allow read-only custom tools
    analysis.custom_tools = analysis.custom_tools.filter(t => validReadOnlyNames.has(t));
    // Clear new_tools_needed — users can't create tools
    analysis.new_tools_needed = [];
    analysis.new_skills_needed = [];
  } else {
    // Admin: allow both read-only and read-write
    analysis.custom_tools = analysis.custom_tools.filter(t =>
      validReadOnlyNames.has(t) || validWriteNames.has(t)
    );
  }

  // Validate write_tools_requested
  if (!analysis.write_tools_requested) analysis.write_tools_requested = [];
  analysis.write_tools_requested = analysis.write_tools_requested.filter(t => validWriteNames.has(t));

  // Check for unconfigured tools
  const allUsedTools = [...(analysis.custom_tools || []), ...(analysis.write_tools_requested || [])];
  const allAvailableTools = [...readOnlyTools, ...writeTools];
  const unconfiguredTools = allUsedTools.filter(toolName => {
    const tool = allAvailableTools.find(t => t.name === toolName);
    return tool && !isToolConfigured(tool);
  });
  if (unconfiguredTools.length > 0) {
    analysis.feasible = false;
    for (const toolName of unconfiguredTools) {
      analysis.blockers.push(`Tool '${toolName}' is registered but not configured by admin.`);
    }
  }

  // Validate credential_modes against manifest connectionModels
  if (!analysis.credential_modes) analysis.credential_modes = {};
  const allCustomToolNames = [...(analysis.custom_tools || []), ...(analysis.write_tools_requested || [])];
  const usedIntegrationIds = new Set<string>();
  try {
    const integrations = getIntegrations();
    for (const toolName of allCustomToolNames) {
      for (const integ of integrations) {
        if ((integ as any).tools?.some((t: any) => t.name === toolName)) {
          usedIntegrationIds.add(integ.id);
        }
      }
    }
    // Remove entries for integrations not used by the agent
    for (const integId of Object.keys(analysis.credential_modes)) {
      if (!usedIntegrationIds.has(integId)) {
        delete analysis.credential_modes[integId];
        continue;
      }
      const integ = integrations.find(i => i.id === integId);
      if (!integ) { delete analysis.credential_modes[integId]; continue; }
      const cm = (integ as any).connectionModel || 'team';
      const mode = analysis.credential_modes[integId];
      // Correct modes that violate connectionModel constraints
      if (cm === 'team' && mode !== 'team') analysis.credential_modes[integId] = 'team';
      if (cm === 'personal' && mode === 'team') analysis.credential_modes[integId] = 'delegated';
    }
  } catch { /* best-effort */ }

  // Ensure defaults
  if (!analysis.relevance_keywords) analysis.relevance_keywords = [];
  if (!analysis.triggers) analysis.triggers = [];
  if (analysis.respond_to_all_messages === undefined) analysis.respond_to_all_messages = false;
  if (analysis.mentions_only === undefined) analysis.mentions_only = false;
  if (analysis.feasible === undefined) analysis.feasible = true;
  if (!analysis.blockers) analysis.blockers = [];
  if (!analysis.new_tools_needed) analysis.new_tools_needed = [];
  if (!analysis.new_skills_needed) analysis.new_skills_needed = [];

  logger.info('Goal analyzed', {
    goal: goal.slice(0, 100),
    tools: analysis.tools,
    customTools: analysis.custom_tools,
    writeToolsRequested: analysis.write_tools_requested,
    skills: analysis.skills,
    model: analysis.model,
    triggers: analysis.triggers.length,
    respondToAll: analysis.respond_to_all_messages,
    credentialModes: analysis.credential_modes,
    isAdmin,
  });

  return analysis;
}

/**
 * Quick relevance check — determines if a message is relevant to an agent's goal.
 * Uses keyword matching first, falls back to LLM for ambiguous cases.
 */
export async function checkMessageRelevance(
  message: string,
  agentGoalKeywords: string[],
  systemPrompt: string,
  respondToAll: boolean
): Promise<boolean> {
  // If agent should respond to all messages, always relevant
  if (respondToAll) return true;

  const trimmed = message.trim();
  if (trimmed.length < 3) return false; // Too short to be meaningful

  // Domain/URL-like messages are always relevant (e.g., "google.com", "https://example.org")
  const domainPattern = /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}/i;
  if (domainPattern.test(trimmed)) return true;

  // Check keyword match (case-insensitive)
  const lowerMessage = trimmed.toLowerCase();
  if (agentGoalKeywords.length > 0) {
    const keywordMatch = agentGoalKeywords.some(kw =>
      lowerMessage.includes(kw.toLowerCase())
    );
    if (keywordMatch) return true;
  }

  // For messages that don't match keywords, use a fast LLM check
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: `You are a relevance classifier. Given an agent's purpose and an incoming message, respond with ONLY "yes" or "no" — is this message something the agent should respond to?\n\nAgent purpose: ${systemPrompt.slice(0, 500)}`,
      messages: [{
        role: 'user',
        content: trimmed.slice(0, 300),
      }],
    });

    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .toLowerCase();

    return answer.startsWith('yes');
  } catch (err) {
    // On error, default to not responding (safer than spamming)
    logger.warn('Relevance check failed, defaulting to skip', { error: String(err) });
    return false;
  }
}
