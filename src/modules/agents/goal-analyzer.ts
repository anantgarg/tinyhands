import Anthropic from '@anthropic-ai/sdk';
import { getBuiltinTools } from '../tools';
import { getAvailableSkills } from '../skills';
import { logger } from '../../utils/logger';

export interface GoalAnalysis {
  agent_name: string;
  system_prompt: string;
  tools: string[];
  skills: string[];
  model: 'opus' | 'sonnet' | 'haiku';
  permission_level: 'read-only' | 'standard' | 'full';
  memory_enabled: boolean;
  triggers: Array<{
    type: 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook';
    description: string;
    config: Record<string, any>;
  }>;
  relevance_keywords: string[];
  respond_to_all_messages: boolean;
  new_tools_needed: Array<{ name: string; description: string }>;
  new_skills_needed: Array<{ name: string; description: string }>;
  feasible: boolean;
  blockers: string[];
  summary: string;
}

export async function analyzeGoal(goal: string, existingPrompt?: string, requestingUserId?: string): Promise<GoalAnalysis> {
  const client = new Anthropic();
  const builtinTools = getBuiltinTools();
  const availableSkills = getAvailableSkills();

  const skillList = [
    ...availableSkills.mcp.map(s => `MCP: ${s.name} (${s.capabilities.join(', ')})`),
    ...availableSkills.prompt.map(s => `Prompt: ${s.name} (${s.description})`),
  ];

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: `You are an expert agent architect. Given an agent's goal, you deeply analyze what's needed and produce a complete agent configuration. Think step by step about what the agent needs to accomplish its goal.

Available built-in tools: ${builtinTools.join(', ')}
Available MCP/prompt skills:
${skillList.join('\n')}

Available trigger types: slack_channel, linear, zendesk, intercom, webhook

Return ONLY valid JSON matching this schema:
{
  "agent_name": "short-kebab-case-name (max 20 chars, descriptive)",
  "system_prompt": "A comprehensive system prompt. This is the MOST IMPORTANT part. It must clearly define:\n1. WHO the agent is (role, personality)\n2. WHAT it does (specific tasks, responsibilities)\n3. HOW it behaves (tone, format, decision-making rules)\n4. WHEN it should respond vs stay silent\n5. Its tools and how to use them\n6. Output format preferences (use Slack mrkdwn: *bold*, _italic_, \`code\`, bullet lists with •)\n7. Constraints and limitations\nThe prompt should be detailed enough that the agent knows exactly what to do without further guidance.",
  "tools": ["list", "of", "required", "builtin", "tools"],
  "skills": ["list", "of", "required", "skill", "names", "from", "available", "ones"],
  "model": "sonnet|opus|haiku",
  "permission_level": "read-only|standard|full",
  "memory_enabled": true/false,
  "triggers": [
    {
      "type": "slack_channel|linear|zendesk|intercom|webhook",
      "description": "human-readable description of when this triggers",
      "config": {"events": ["..."], "description": "..."}
    }
  ],
  "relevance_keywords": ["keywords", "that", "indicate", "a", "message", "is", "relevant", "to", "this", "agent"],
  "respond_to_all_messages": false,
  "new_tools_needed": [{"name": "kebab-case-name", "description": "detailed description of what this tool should do"}],
  "new_skills_needed": [{"name": "kebab-case-name", "description": "detailed description of what this skill template should do"}],
  "feasible": true,
  "blockers": [],
  "summary": "2-3 sentence explanation of the configuration and why each choice was made"
}

IMPORTANT guidelines:
- The system_prompt is the agent's brain. Make it extremely detailed and specific to the goal. Include explicit instructions about output formatting for Slack (no markdown headers, use *bold* not **bold**, use • for bullets, etc.)
- respond_to_all_messages should be true ONLY if the agent's goal explicitly requires responding to every single message (e.g., a chatbot that handles all incoming queries). For most agents, this should be false — they should only respond to messages relevant to their goal.
- relevance_keywords: list words/phrases that, if present in a message, indicate the agent should process it. Include both obvious keywords and contextual ones. For agents that should respond to all messages, this can be empty.
- triggers: if the goal mentions reacting to external events (new tickets, issues, PRs, webhooks, messages in other channels), configure appropriate triggers. Leave empty if the agent only responds to direct messages in its channel.
- Always include Read, Glob, Grep for code/content-related agents
- Include Write, Edit, Bash for agents that modify files or run commands
- Include WebSearch, WebFetch for research-heavy agents
- Use opus for complex multi-step reasoning, haiku for simple/fast classification, sonnet for general purpose
- Enable memory for agents that build up context over time
- If the goal requires capabilities that don't exist in available tools/skills, propose them in new_tools_needed/new_skills_needed with detailed descriptions
- FEASIBILITY: Set "feasible" to true if the agent can work with existing tools/skills OR with new ones that can be auto-created (simple scripts, API wrappers, data processing). Set "feasible" to false ONLY if the goal requires platform-level changes that can't be solved by tools/skills alone — e.g., new integrations with external services not yet supported, access to APIs we don't have credentials for, hardware capabilities, or architectural changes to the platform. When feasible is false, list specific blockers explaining what's missing and why it can't be auto-created.
- SLACK MENTIONS: If the goal references tagging/mentioning/notifying a specific person, use the Slack mention format <@USER_ID> in the system_prompt. The requesting user's Slack ID is provided below — use it when the goal says "tag me", "notify me", "mention me", etc. For other users mentioned by name, include a note in the system_prompt to use <@USER_ID> format and that the admin should configure the correct user ID.`,
    messages: [{
      role: 'user',
      content: (existingPrompt
        ? `Current system prompt:\n${existingPrompt}\n\nUser's update request:\n${goal}\n\nIMPORTANT: The user may describe a problem, a specific tweak, or a full new goal. If they describe a problem or a small change, make targeted incremental edits to the existing system_prompt — preserve everything that's working and only modify what's needed to address their request. If they provide a completely new goal, generate a fresh prompt. Keep the agent_name from current config if not explicitly changing it.`
        : `Agent goal:\n${goal}`) + (requestingUserId ? `\n\nRequesting user's Slack ID: ${requestingUserId}` : ''),
    }],
  });

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

  // Validate tools are real builtin tools
  analysis.tools = analysis.tools.filter(t => builtinTools.includes(t));

  // Ensure defaults
  if (!analysis.relevance_keywords) analysis.relevance_keywords = [];
  if (!analysis.triggers) analysis.triggers = [];
  if (analysis.respond_to_all_messages === undefined) analysis.respond_to_all_messages = false;
  if (analysis.feasible === undefined) analysis.feasible = true;
  if (!analysis.blockers) analysis.blockers = [];

  logger.info('Goal analyzed', {
    goal: goal.slice(0, 100),
    tools: analysis.tools,
    skills: analysis.skills,
    model: analysis.model,
    triggers: analysis.triggers.length,
    respondToAll: analysis.respond_to_all_messages,
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

  // If message is short and looks like a direct question/command, it's relevant
  const trimmed = message.trim();
  if (trimmed.length < 10) return false; // Too short to be meaningful

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
