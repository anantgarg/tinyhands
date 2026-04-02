import { useState, useCallback, useRef, useEffect } from 'react';
import { useAnalyzeGoal, useCreateAgent, useAddAgentTrigger } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { useSlackChannels } from '@/api/slack';
import type { ConfirmationConfig } from './cards/ConfirmationCard';

// ── Types ──

export type CardType =
  | 'multi-choice'
  | 'yes-no'
  | 'dropdown'
  | 'multi-select'
  | 'confirmation'
  | 'schedule'
  | 'prompt-preview';

export interface CreationMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  cardType?: CardType;
  cardProps?: Record<string, unknown>;
  disabled?: boolean;
}

export type Phase =
  | 'INIT'
  | 'DESCRIBE'
  | 'ANALYZING'
  | 'SUMMARY'
  | 'CLARIFY'
  | 'PROMPT_REVIEW'
  | 'CHANNEL'
  | 'ACTIVATION'
  | 'SCHEDULE_ASK'
  | 'SCHEDULE'
  | 'TOOLS'
  | 'EFFORT'
  | 'MEMORY'
  | 'ACCESS'
  | 'APPROVAL'
  | 'CONFIRM'
  | 'CHANGE_REQUEST'
  | 'CREATING'
  | 'DONE';

interface AgentConfig {
  name: string;
  avatarEmoji: string;
  systemPrompt: string;
  model: string;
  maxTurns: number;
  tools: string[];
  channelId: string;
  channelName: string;
  activation: string; // 'mentions' | 'relevant' | 'all'
  memoryEnabled: boolean;
  defaultAccess: string;
  writePolicy: string;
  scheduleCron: string;
  scheduleTimezone: string;
  triggers: Array<{ type: string; description: string; config: Record<string, unknown> }>;
  credentialModes: Record<string, string>;
}

export interface CreationFlow {
  messages: CreationMessage[];
  phase: Phase;
  config: Partial<AgentConfig>;
  isAnalyzing: boolean;
  isCreating: boolean;
  createdAgentId: string | null;
  sendMessage: (text: string) => void;
  handleCardResponse: (messageId: string, response: unknown) => void;
  inputDisabled: boolean;
  refetchChannels: () => void;
  channelsFetching: boolean;
}

// ── Helpers ──

let counter = 0;
function msgId(): string {
  return `cm-${Date.now()}-${++counter}`;
}

const BUILTIN_FRIENDLY_NAMES: Record<string, string> = {
  'serpapi-read': 'SerpAPI',
  'kb-search': 'Knowledge Base',
  'chargebee-read': 'Chargebee',
  'chargebee-write': 'Chargebee',
  'hubspot-read': 'HubSpot',
  'hubspot-write': 'HubSpot',
  'linear-read': 'Linear',
  'linear-write': 'Linear',
  'zendesk-read': 'Zendesk',
  'zendesk-write': 'Zendesk',
  'posthog-read': 'PostHog',
  'google-drive-read': 'Google Drive',
  'google-drive-write': 'Google Drive',
  'google-sheets-read': 'Google Sheets',
  'google-sheets-write': 'Google Sheets',
  'google-docs-read': 'Google Docs',
  'google-docs-write': 'Google Docs',
  'gmail-read': 'Gmail',
  'gmail-write': 'Gmail',
};

function hasTimePattern(text: string): boolean {
  const patterns = /\b(daily|hourly|weekly|every\s+(hour|day|week|morning|evening|night)|schedule|cron|recurring|at\s+\d{1,2}\s*(am|pm)|each\s+(morning|day|week))\b/i;
  return patterns.test(text);
}

function hasWriteTools(tools: string[]): boolean {
  return tools.some((t) => t.endsWith('-write'));
}

interface GoalAnalysisRaw {
  name?: string;
  agent_name?: string;
  avatarEmoji?: string;
  avatar_emoji?: string;
  systemPrompt?: string;
  system_prompt?: string;
  model?: string;
  tools?: string[];
  custom_tools?: string[];
  mentionsOnly?: boolean;
  mentions_only?: boolean;
  memoryEnabled?: boolean;
  memory_enabled?: boolean;
  summary?: string;
  triggers?: Array<{ type: string; description: string; config: Record<string, unknown> }>;
  credential_modes?: Record<string, string>;
}

function getConfidenceLevel(analysis: GoalAnalysisRaw): 'high' | 'medium' | 'low' {
  const customTools = analysis.custom_tools || analysis.tools || [];
  const triggers = analysis.triggers || [];
  const prompt = analysis.system_prompt || analysis.systemPrompt || '';
  const hasTools = customTools.length > 0;
  const hasTriggers = triggers.length > 0;
  const hasDetailedPrompt = prompt.length > 500;
  const score = (hasTools ? 1 : 0) + (hasTriggers ? 1 : 0) + (hasDetailedPrompt ? 1 : 0);
  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

function friendlyToolName(toolName: string): string {
  return BUILTIN_FRIENDLY_NAMES[toolName] || toolName.replace(/-read$/, '').replace(/-write$/, '').replace(/-search$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Clean technical tool names from AI-generated text (e.g., "zendesk-read" → "Zendesk")
function cleanTechnicalNames(text: string): string {
  return text
    .replace(/\b(google-sheets|google-drive|google-docs|gmail|hubspot|zendesk|linear|chargebee|posthog|serpapi)-(read|write|search)\b/gi,
      (match) => friendlyToolName(match))
    .replace(/\(requires admin approval\)/gi, '')
    .replace(/\(needs admin approval\)/gi, '')
    .replace(/\bdelegated\s+(personal\s+)?credentials?\b/gi, "the agent creator's credentials")
    .replace(/\bruntime\s+credentials?\b/gi, "each user's own credentials")
    .replace(/\bteam\s+credentials?\b/gi, 'shared team credentials')
    .replace(/\bcredential\s+mode\b/gi, 'credentials')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Hook ──

export function useCreationFlow(): CreationFlow {
  const [messages, setMessages] = useState<CreationMessage[]>([]);
  const [phase, setPhase] = useState<Phase>('INIT');
  const [config, setConfig] = useState<Partial<AgentConfig>>({
    model: 'sonnet',
    maxTurns: 25,
    activation: 'relevant',
    memoryEnabled: false,
    defaultAccess: 'member',
    writePolicy: 'auto',
    tools: [],
    triggers: [],
    credentialModes: {},
  });
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const goalRef = useRef('');
  const skipPhasesRef = useRef<Set<Phase>>(new Set());
  const confidenceRef = useRef<'high' | 'medium' | 'low'>('medium');
  const analysisRef = useRef<GoalAnalysisRaw | null>(null);

  const analyzeGoal = useAnalyzeGoal();
  const createAgent = useCreateAgent();
  const addTrigger = useAddAgentTrigger();
  const { data: availableTools } = useAvailableTools();
  const { data: channelsData, refetch: refetchChannels, isFetching: channelsFetching } = useSlackChannels();

  const channels = channelsData?.channels || [];

  // Build integration groups for the tools card
  const integrationGroups = (() => {
    const groups: Record<string, { base: string; displayName: string; readTool?: string; writeTool?: string }> = {};
    for (const tool of availableTools ?? []) {
      if (tool.source !== 'integration') continue;
      const readMatch = tool.name.match(/^(.+)-(read|search)$/);
      const writeMatch = tool.name.match(/^(.+)-write$/);
      const base = readMatch?.[1] || writeMatch?.[1];
      if (!base) continue;
      if (!groups[base]) {
        const friendly = BUILTIN_FRIENDLY_NAMES[`${base}-read`] || BUILTIN_FRIENDLY_NAMES[`${base}-search`];
        const baseName = friendly || base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' ');
        groups[base] = { base, displayName: baseName };
      }
      if (readMatch) groups[base].readTool = tool.name;
      if (writeMatch) groups[base].writeTool = tool.name;
    }
    return Object.values(groups);
  })();

  const addMsg = useCallback((msg: CreationMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const disableLastCard = useCallback(() => {
    setMessages((prev) => {
      const last = [...prev];
      for (let i = last.length - 1; i >= 0; i--) {
        if (last[i].cardType && !last[i].disabled) {
          last[i] = { ...last[i], disabled: true };
          break;
        }
      }
      return last;
    });
  }, []);

  // ── Phase transitions ──

  const goToChannel = useCallback(async () => {
    setPhase('CHANNEL');

    // Ensure channels are loaded fresh
    const result = await refetchChannels();
    const freshChannels = result.data?.channels || [];

    const channelOptions = [
      { value: '__create__', label: '+ Create a new channel' },
      ...freshChannels.map((ch) => ({
        value: ch.id,
        label: `${ch.isPrivate ? '' : '#'}${ch.name}`,
        isPrivate: ch.isPrivate,
      })),
    ];
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Which Slack channel should this agent live in?',
      cardType: 'dropdown',
      cardProps: {
        options: channelOptions.length > 1 ? channelOptions : [{ value: '__create__', label: '+ Create a new channel' }],
        placeholder: 'Search for a channel...',
        searchable: true,
        helpText: "Don't see your channel? Private channels need TinyHands to be invited first. Use /invite @TinyHands in the channel.",
      },
    });
  }, [refetchChannels, addMsg]);

  const goToActivation = useCallback(() => {
    setPhase('ACTIVATION');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'When should the agent respond in its channel?',
      cardType: 'multi-choice',
      cardProps: {
        options: [
          { value: 'relevant', label: 'Relevant messages', description: 'Uses AI to decide if a message needs a response', recommended: true },
          { value: 'all', label: 'Every message', description: 'Responds to everything in the channel' },
          { value: 'mentions', label: 'Only when @mentioned', description: 'Stays quiet unless directly called on' },
        ],
        defaultValue: config.activation || 'relevant',
      },
    });
  }, [addMsg, config.activation]);

  const goToScheduleAsk = useCallback(() => {
    if (skipPhasesRef.current.has('SCHEDULE_ASK')) {
      goToTools();
      return;
    }
    setPhase('SCHEDULE_ASK');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Should this agent run on a schedule? For example, you might want it to send a daily summary or check something every hour.',
      cardType: 'yes-no',
      cardProps: {
        yesLabel: 'Yes, set up a schedule',
        noLabel: 'No, just on-demand',
      },
    });
  }, [addMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToSchedule = useCallback(() => {
    setPhase('SCHEDULE');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'How often should it run?',
      cardType: 'schedule',
      cardProps: {},
    });
  }, [addMsg]);

  const goToTools = useCallback(() => {
    setPhase('TOOLS');

    // Filter to integrations that have at least one registered tool
    const validGroups = integrationGroups.filter(g => g.readTool || g.writeTool);

    if (validGroups.length === 0) {
      // No integrations available — show which tools are needed but not connected
      const analysisTools = config.tools || [];
      const neededNames = [...new Set(analysisTools.map(t => friendlyToolName(t)))];
      const content = neededNames.length > 0
        ? `This agent needs **${neededNames.join(', ')}**, but ${neededNames.length === 1 ? "it hasn't" : "they haven't"} been connected yet. You can connect them from the **Tools & Integrations** page, then add them to this agent from its settings.\n\nCore tools like file access, web search, and code analysis are always included.`
        : 'No connected services yet. Core tools like file access, web search, and code analysis are always included.';
      addMsg({
        id: msgId(),
        role: 'assistant',
        content,
        cardType: 'multi-choice',
        cardProps: {
          options: [
            { value: 'continue', label: 'Continue', description: 'You can connect services later from Tools & Integrations' },
          ],
        },
      });
      return;
    }

    // Pre-select tools from analysis (use actual tool names for MultiSelectCard)
    const analysisTools = config.tools || [];
    const preSelected = validGroups
      .filter(g => analysisTools.some(t => g.readTool === t || g.writeTool === t))
      .flatMap(g => {
        const names: string[] = [];
        if (g.readTool && analysisTools.includes(g.readTool)) names.push(g.readTool);
        if (g.writeTool && analysisTools.includes(g.writeTool)) names.push(g.writeTool);
        // If analyzer recommended any tool from this group, at minimum include read
        if (names.length === 0 && g.readTool) names.push(g.readTool);
        return names;
      });

    const options = validGroups.map((g) => ({
      value: g.base,
      label: g.displayName,
      readToolName: g.readTool,
      writeToolName: g.writeTool,
      hasWrite: !!g.writeTool,
    }));

    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Which services should this agent have access to? Core tools like file access, web search, and code analysis are always included.',
      cardType: 'multi-select',
      cardProps: {
        options,
        defaultValues: preSelected,
      },
    });
  }, [integrationGroups, addMsg, config.tools]);

  const goToEffort = useCallback(() => {
    if (skipPhasesRef.current.has('EFFORT')) {
      goToMemory();
      return;
    }
    setPhase('EFFORT');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'How much effort should the agent put into each response? Higher effort means more thorough but slower.',
      cardType: 'multi-choice',
      cardProps: {
        options: [
          { value: '10', label: 'Quick', description: 'Fast, single-turn answers' },
          { value: '25', label: 'Standard', description: 'Good for most tasks', recommended: true },
          { value: '50', label: 'Thorough', description: 'Deep research and iteration' },
          { value: '100', label: 'Maximum', description: 'Complex, multi-tool investigations' },
        ],
        defaultValue: String(config.maxTurns || 25),
      },
    });
  }, [addMsg, config.maxTurns]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToMemory = useCallback(() => {
    if (skipPhasesRef.current.has('MEMORY')) {
      goToAccess();
      return;
    }
    setPhase('MEMORY');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Should this agent remember things across conversations? When enabled, it learns facts, preferences, and context over time.',
      cardType: 'yes-no',
      cardProps: {
        yesLabel: 'Yes, enable memory',
        noLabel: 'No, start fresh each time',
      },
    });
  }, [addMsg]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToAccess = useCallback(() => {
    setPhase('ACCESS');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Who should have access to this agent?',
      cardType: 'multi-choice',
      cardProps: {
        options: [
          { value: 'member', label: 'Full Access', description: 'Everyone in the workspace can use this agent', recommended: true },
          { value: 'viewer', label: 'View Only', description: 'Everyone can see it, but must request access to take actions' },
          { value: 'none', label: 'Invite Only', description: 'Only people you explicitly invite can see this agent' },
        ],
        defaultValue: config.defaultAccess || 'member',
      },
    });
  }, [addMsg, config.defaultAccess]);

  const goToApproval = useCallback(() => {
    if (skipPhasesRef.current.has('APPROVAL')) {
      goToConfirm();
      return;
    }
    setPhase('APPROVAL');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'This agent has services that can make changes (create tickets, send emails, etc.). Should it ask for permission first?',
      cardType: 'multi-choice',
      cardProps: {
        options: [
          { value: 'auto', label: 'Automatic', description: 'Agent acts without asking' },
          { value: 'confirm', label: 'Ask User First', description: 'Asks the person who triggered it before making changes' },
          { value: 'admin_confirm', label: 'Ask Owner/Admins', description: 'Asks the agent\'s owner or admins before making changes' },
        ],
        defaultValue: config.writePolicy || 'auto',
      },
    });
  }, [addMsg, config.writePolicy]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToConfirm = useCallback(() => {
    setPhase('CONFIRM');
    const confirmConfig: ConfirmationConfig = {
      name: config.name || 'New Agent',
      avatarEmoji: config.avatarEmoji,
      model: config.model || 'sonnet',
      maxTurns: config.maxTurns || 25,
      activation: config.activation || 'relevant',
      memoryEnabled: config.memoryEnabled || false,
      defaultAccess: config.defaultAccess || 'member',
      writePolicy: config.writePolicy || 'auto',
      tools: config.tools || [],
      channelName: config.channelName,
      scheduleCron: config.scheduleCron,
      scheduleTimezone: config.scheduleTimezone,
      systemPrompt: config.systemPrompt,
      triggers: config.triggers?.map(t => ({ type: t.type, description: t.description })),
      credentialModes: config.credentialModes,
    };
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Here\'s what we\'ve got. Take a look and let me know if everything looks good!',
      cardType: 'confirmation',
      cardProps: { config: confirmConfig },
    });
  }, [addMsg, config]);

  const goToPromptReview = useCallback((promptOverride?: string) => {
    setPhase('PROMPT_REVIEW');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'I\'ve written detailed instructions for your agent. You can review them below or skip ahead.',
      cardType: 'prompt-preview',
      cardProps: {
        prompt: promptOverride || config.systemPrompt || '',
      },
    });
  }, [addMsg, config.systemPrompt]);

  const doCreate = useCallback(async () => {
    setPhase('CREATING');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Creating your agent...',
    });

    const mentionsOnly = config.activation === 'mentions';
    const respondToAll = config.activation === 'all';

    try {
      const agent = await createAgent.mutateAsync({
        name: config.name || 'New Agent',
        avatarEmoji: config.avatarEmoji || undefined,
        systemPrompt: config.systemPrompt || '',
        model: config.model || 'sonnet',
        tools: config.tools || [],
        channelIds: config.channelId ? [config.channelId] : undefined,
        memoryEnabled: config.memoryEnabled || false,
        maxTurns: config.maxTurns || 25,
        mentionsOnly,
        respondToAllMessages: respondToAll,
        defaultAccess: config.defaultAccess || 'member',
        writePolicy: config.writePolicy || 'auto',
        credentialModes: config.credentialModes && Object.keys(config.credentialModes).length > 0
          ? config.credentialModes
          : undefined,
      });

      // Create schedule trigger if configured
      if (config.scheduleCron) {
        try {
          await addTrigger.mutateAsync({
            agentId: agent.id,
            type: 'schedule',
            config: {
              cron: config.scheduleCron,
              timezone: config.scheduleTimezone || 'UTC',
            },
          });
        } catch {
          // Non-fatal: agent was created, schedule just failed
        }
      }

      // Create any non-schedule triggers from the analysis
      if (config.triggers && config.triggers.length > 0) {
        for (const trigger of config.triggers) {
          if (trigger.type === 'schedule') continue; // Already handled above
          try {
            await addTrigger.mutateAsync({
              agentId: agent.id,
              type: trigger.type,
              config: trigger.config,
            });
          } catch {
            // Non-fatal
          }
        }
      }

      setCreatedAgentId(agent.id);
      setPhase('DONE');
      addMsg({
        id: msgId(),
        role: 'assistant',
        content: `Your agent "${config.name}" is ready! It has its own Slack channel and is waiting for messages. You can view and fine-tune it from its settings page.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setPhase('CONFIRM');
      addMsg({
        id: msgId(),
        role: 'assistant',
        content: `Something went wrong while creating the agent: ${message}. Let's try again.`,
      });
      goToConfirm();
    }
  }, [config, createAgent, addTrigger, addMsg, goToConfirm]);

  // ── Initialize on mount ──

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setPhase('DESCRIBE');
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Hi! I\'ll help you create a new agent. Describe what you\'d like it to do, and I\'ll set everything up for you.\n\nFor example: "A support agent that answers customer questions using our knowledge base and creates Zendesk tickets when needed."',
    });
  }, [addMsg]);

  // ── Build rich summary text ──

  const buildSummaryText = useCallback((analysis: GoalAnalysisRaw) => {
    const name = analysis.agent_name || analysis.name || 'New Agent';
    const emoji = analysis.avatar_emoji || analysis.avatarEmoji || '';
    const model = (analysis.model || 'sonnet');
    const modelLabel = model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet';
    const summary = cleanTechnicalNames(analysis.summary || '');
    const customTools = analysis.custom_tools || [];
    const triggers = analysis.triggers || [];
    const memory = analysis.memory_enabled ?? analysis.memoryEnabled ?? false;

    let text = `Here's the plan for your new agent:\n\n`;
    text += `**${emoji} ${name}**\n\n`;

    if (summary) {
      text += `${summary}\n\n`;
    }

    // Model choice
    text += `**Model:** ${modelLabel}`;
    if (model.includes('opus')) text += ' (most capable, for complex reasoning)';
    else if (model.includes('haiku')) text += ' (fastest, for quick responses)';
    else text += ' (balanced, recommended for most tasks)';
    text += '\n';

    // Recommended tools
    if (customTools.length > 0) {
      // Group by friendly name and determine capabilities
      const toolGroups: Record<string, { hasRead: boolean; hasWrite: boolean }> = {};
      for (const t of customTools) {
        const name = friendlyToolName(t);
        if (!toolGroups[name]) toolGroups[name] = { hasRead: false, hasWrite: false };
        if (t.endsWith('-read') || t.endsWith('-search')) toolGroups[name].hasRead = true;
        if (t.endsWith('-write')) toolGroups[name].hasWrite = true;
      }
      const toolLabels = Object.entries(toolGroups).map(([name, caps]) => {
        if (caps.hasRead && caps.hasWrite) return `${name} (view & edit)`;
        if (caps.hasWrite) return `${name} (edit)`;
        return name;
      });
      text += `**Services:** ${toolLabels.join(', ')}\n`;
    }

    // Triggers
    if (triggers.length > 0) {
      const triggerDescs = triggers.map((t) => t.description || t.type).join(', ');
      text += `**Triggers:** ${triggerDescs}\n`;
    }

    // Memory
    text += `**Memory:** ${memory ? 'Enabled (learns over time)' : 'Disabled (fresh each time)'}\n`;

    text += `\nLet me show you the instructions I've written, then we'll pick a channel and finalize the settings.`;

    return text;
  }, []);

  // ── Handle text input ──

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      addMsg({ id: msgId(), role: 'user', content: trimmed });

      if (phase === 'DESCRIBE') {
        goalRef.current = trimmed;
        setPhase('ANALYZING');
        addMsg({
          id: msgId(),
          role: 'assistant',
          content: 'Let me think about the best setup for that...',
        });

        analyzeGoal.mutate(trimmed, {
          onSuccess: (result: GoalAnalysisRaw) => {
            analysisRef.current = result;
            const name = result.agent_name || result.name || 'New Agent';
            const emoji = result.avatar_emoji || result.avatarEmoji || '';
            const prompt = result.system_prompt || result.systemPrompt || '';
            const model = result.model?.includes('opus') ? 'opus' : result.model?.includes('haiku') ? 'haiku' : 'sonnet';
            const tools = [...(result.custom_tools || result.tools || [])];
            const memory = result.memory_enabled ?? result.memoryEnabled ?? false;
            const mentions = result.mentions_only ?? result.mentionsOnly ?? false;
            const triggers = result.triggers || [];
            const credentialModes = result.credential_modes || {};

            setConfig((prev) => ({
              ...prev,
              name,
              avatarEmoji: emoji,
              systemPrompt: prompt,
              model,
              tools,
              memoryEnabled: memory,
              activation: mentions ? 'mentions' : 'relevant',
              triggers,
              credentialModes,
            }));

            // Determine confidence level
            const confidence = getConfidenceLevel(result);
            confidenceRef.current = confidence;

            // Decide which phases to skip based on confidence
            const skips = new Set<Phase>();

            if (confidence === 'high') {
              // High confidence: skip CLARIFY, EFFORT, MEMORY
              skips.add('CLARIFY');
              skips.add('EFFORT');
              skips.add('MEMORY');
            } else if (confidence === 'medium') {
              // Medium confidence: skip EFFORT, MEMORY
              skips.add('EFFORT');
              skips.add('MEMORY');
            }
            // Low confidence: don't skip CLARIFY, EFFORT, MEMORY

            // Skip schedule ask if no time pattern in user text AND analyzer didn't suggest triggers
            if (!hasTimePattern(trimmed) && triggers.length === 0) {
              skips.add('SCHEDULE_ASK');
            }

            // Skip approval if no write tools
            if (!hasWriteTools(tools)) {
              skips.add('APPROVAL');
            }

            skipPhasesRef.current = skips;

            // Show rich summary
            setPhase('SUMMARY');
            const summaryText = buildSummaryText(result);
            addMsg({ id: msgId(), role: 'assistant', content: summaryText });

            // Move to next phase based on confidence
            if (confidence === 'low') {
              // Low confidence: go to CLARIFY first
              setPhase('CLARIFY');
              addMsg({
                id: msgId(),
                role: 'assistant',
                content: 'I\'d like to understand a bit more. Could you tell me more about what specific tasks this agent should handle? For example, what kind of data should it work with, or what actions should it take?',
              });
            } else {
              // Medium/High: go to PROMPT_REVIEW
              goToPromptReview(prompt);
            }
          },
          onError: (err) => {
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: `I had trouble analyzing that: ${err.message}. Could you describe the agent's purpose again?`,
            });
            setPhase('DESCRIBE');
          },
        });
      } else if (phase === 'CLARIFY') {
        // User provided more details - re-analyze with combined context
        setPhase('ANALYZING');
        addMsg({
          id: msgId(),
          role: 'assistant',
          content: 'Got it, let me refine the setup...',
        });

        const combinedGoal = `${goalRef.current}\n\nAdditional details: ${trimmed}`;
        goalRef.current = combinedGoal;

        analyzeGoal.mutate(combinedGoal, {
          onSuccess: (result: GoalAnalysisRaw) => {
            analysisRef.current = result;
            const name = result.agent_name || result.name || 'New Agent';
            const emoji = result.avatar_emoji || result.avatarEmoji || '';
            const prompt = result.system_prompt || result.systemPrompt || '';
            const model = result.model?.includes('opus') ? 'opus' : result.model?.includes('haiku') ? 'haiku' : 'sonnet';
            const tools = [...(result.custom_tools || result.tools || [])];
            const memory = result.memory_enabled ?? result.memoryEnabled ?? false;
            const mentions = result.mentions_only ?? result.mentionsOnly ?? false;
            const triggers = result.triggers || [];
            const credentialModes = result.credential_modes || {};

            setConfig((prev) => ({
              ...prev,
              name,
              avatarEmoji: emoji,
              systemPrompt: prompt,
              model,
              tools,
              memoryEnabled: memory,
              activation: mentions ? 'mentions' : 'relevant',
              triggers,
              credentialModes,
            }));

            // Re-check skips
            if (!hasWriteTools(tools)) {
              skipPhasesRef.current.add('APPROVAL');
            } else {
              skipPhasesRef.current.delete('APPROVAL');
            }

            // Show updated summary
            const summaryText = buildSummaryText(result);
            addMsg({ id: msgId(), role: 'assistant', content: summaryText });

            goToPromptReview(prompt);
          },
          onError: (err) => {
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: `I had trouble with that: ${err.message}. Let's continue with what we have.`,
            });
            goToPromptReview();
          },
        });
      } else if (phase === 'PROMPT_REVIEW') {
        // User wants to edit the prompt - they've typed changes
        setPhase('ANALYZING');
        addMsg({
          id: msgId(),
          role: 'assistant',
          content: 'Updating the instructions...',
        });

        const editRequest = `${goalRef.current}\n\nPlease update the instructions: ${trimmed}`;

        analyzeGoal.mutate(editRequest, {
          onSuccess: (result: GoalAnalysisRaw) => {
            const prompt = result.system_prompt || result.systemPrompt || '';
            setConfig((prev) => ({
              ...prev,
              systemPrompt: prompt,
            }));

            addMsg({
              id: msgId(),
              role: 'assistant',
              content: 'I\'ve updated the instructions. Take another look:',
              cardType: 'prompt-preview',
              cardProps: { prompt },
            });
            setPhase('PROMPT_REVIEW');
          },
          onError: (err) => {
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: `I had trouble updating: ${err.message}. Let's continue with the current instructions.`,
            });
            goToChannel();
          },
        });
      } else if (phase === 'CHANNEL') {
        // User typed a channel name for creation
        const channelName = trimmed.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/^-+|-+$/g, '');
        setConfig((prev) => ({ ...prev, channelId: '', channelName: channelName }));
        addMsg({
          id: msgId(),
          role: 'assistant',
          content: `Great, I'll create a channel called **#${channelName}** for your agent.`,
        });
        goToActivation();
      } else if (phase === 'CHANGE_REQUEST') {
        // User asked to change something from the confirmation screen
        const lower = trimmed.toLowerCase();
        if (lower.includes('name')) {
          addMsg({ id: msgId(), role: 'assistant', content: 'What would you like to name the agent?' });
        } else if (lower.includes('model')) {
          setPhase('CHANGE_REQUEST');
          addMsg({
            id: msgId(),
            role: 'assistant',
            content: 'Which model would you like?',
            cardType: 'multi-choice',
            cardProps: {
              options: [
                { value: 'sonnet', label: 'Sonnet', description: 'Balanced (recommended)', recommended: true },
                { value: 'opus', label: 'Opus', description: 'Most capable' },
                { value: 'haiku', label: 'Haiku', description: 'Fastest' },
              ],
              defaultValue: config.model || 'sonnet',
            },
          });
          return;
        } else if (lower.includes('effort')) {
          skipPhasesRef.current.delete('EFFORT');
          goToEffort();
          return;
        } else if (lower.includes('tool') || lower.includes('service')) {
          goToTools();
          return;
        } else if (lower.includes('access')) {
          goToAccess();
          return;
        } else if (lower.includes('approv') || lower.includes('permission')) {
          skipPhasesRef.current.delete('APPROVAL');
          goToApproval();
          return;
        } else if (lower.includes('memory')) {
          skipPhasesRef.current.delete('MEMORY');
          goToMemory();
          return;
        } else if (lower.includes('channel')) {
          goToChannel();
          return;
        } else if (lower.includes('activ') || lower.includes('respond') || lower.includes('when')) {
          goToActivation();
          return;
        } else if (lower.includes('schedule') || lower.includes('cron')) {
          goToSchedule();
          return;
        } else if (lower.includes('instruction') || lower.includes('prompt')) {
          goToPromptReview();
          return;
        } else {
          // Try to interpret as a name change
          setConfig((prev) => ({ ...prev, name: trimmed }));
          addMsg({
            id: msgId(),
            role: 'assistant',
            content: `Updated the name to "${trimmed}". Let me show you the updated summary.`,
          });
          goToConfirm();
          return;
        }
        // For the "What would you like to name..." path
        setPhase('CHANGE_REQUEST');
      } else if (phase === 'DONE') {
        addMsg({
          id: msgId(),
          role: 'assistant',
          content: 'Your agent is already created! You can view it from the agents page.',
        });
      }
    },
    [phase, analyzeGoal, addMsg, config.model, buildSummaryText, goToChannel, goToActivation, goToTools, goToEffort, goToMemory, goToAccess, goToApproval, goToConfirm, goToSchedule, goToPromptReview],
  );

  // ── Handle card responses ──

  const handleCardResponse = useCallback(
    (_messageId: string, response: unknown) => {
      disableLastCard();

      switch (phase) {
        case 'PROMPT_REVIEW': {
          const { action } = response as { action: 'approve' | 'edit' };
          if (action === 'approve') {
            goToChannel();
          } else {
            // Enable text input for user to describe changes
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: 'Sure! Describe what you\'d like to change about the instructions, and I\'ll update them.',
            });
            // Stay in PROMPT_REVIEW phase — text input will handle the edit
          }
          break;
        }

        case 'CHANNEL': {
          const channelId = response as string;
          if (channelId === '__create__') {
            // Ask for channel name
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: 'What should the channel be called? Use lowercase letters, numbers, and hyphens.',
            });
            // Stay in CHANNEL phase — text input will handle the name
            return;
          }
          const ch = channels.find((c) => c.id === channelId);
          setConfig((prev) => ({ ...prev, channelId, channelName: ch?.name || '' }));
          goToActivation();
          break;
        }

        case 'ACTIVATION': {
          const activation = response as string;
          setConfig((prev) => ({ ...prev, activation }));
          goToScheduleAsk();
          break;
        }

        case 'SCHEDULE_ASK': {
          const wantsSchedule = response as boolean;
          if (wantsSchedule) {
            goToSchedule();
          } else {
            goToTools();
          }
          break;
        }

        case 'SCHEDULE': {
          const { cron, timezone } = response as { cron: string; timezone: string };
          setConfig((prev) => ({ ...prev, scheduleCron: cron, scheduleTimezone: timezone }));
          goToTools();
          break;
        }

        case 'TOOLS': {
          // Handle the "no tools available" multi-choice card
          if (response === 'continue') {
            goToEffort();
            break;
          }
          const tools = response as string[];
          setConfig((prev) => ({ ...prev, tools }));
          // Re-evaluate whether to show approval
          if (hasWriteTools(tools)) {
            skipPhasesRef.current.delete('APPROVAL');
          } else {
            skipPhasesRef.current.add('APPROVAL');
          }
          goToEffort();
          break;
        }

        case 'EFFORT': {
          const maxTurns = Number(response as string);
          setConfig((prev) => ({ ...prev, maxTurns }));
          goToMemory();
          break;
        }

        case 'MEMORY': {
          const memoryEnabled = response as boolean;
          setConfig((prev) => ({ ...prev, memoryEnabled }));
          goToAccess();
          break;
        }

        case 'ACCESS': {
          const defaultAccess = response as string;
          setConfig((prev) => ({ ...prev, defaultAccess }));
          goToApproval();
          break;
        }

        case 'APPROVAL': {
          const writePolicy = response as string;
          setConfig((prev) => ({ ...prev, writePolicy }));
          goToConfirm();
          break;
        }

        case 'CONFIRM': {
          const action = response as string;
          if (action === 'confirm') {
            doCreate();
          } else if (action === 'change') {
            setPhase('CHANGE_REQUEST');
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: 'What would you like to change? You can say things like "change the name", "update the model", "add more tools", "edit instructions", etc.',
            });
          }
          break;
        }

        case 'CHANGE_REQUEST': {
          // Card response during change request (e.g., model selection)
          const value = response as string;
          if (['sonnet', 'opus', 'haiku'].includes(value)) {
            setConfig((prev) => ({ ...prev, model: value }));
            addMsg({
              id: msgId(),
              role: 'assistant',
              content: `Updated the model to ${value.charAt(0).toUpperCase() + value.slice(1)}. Here's the updated summary.`,
            });
          }
          goToConfirm();
          break;
        }

        default:
          break;
      }
    },
    [
      phase, channels, disableLastCard, addMsg,
      goToActivation, goToScheduleAsk, goToSchedule, goToTools,
      goToEffort, goToMemory, goToAccess, goToApproval, goToConfirm, goToChannel, doCreate,
    ],
  );

  const inputDisabled =
    phase === 'ANALYZING' ||
    phase === 'CREATING' ||
    phase === 'DONE' ||
    phase === 'SUMMARY' ||
    (phase !== 'DESCRIBE' && phase !== 'CHANGE_REQUEST' && phase !== 'CLARIFY' && phase !== 'PROMPT_REVIEW' && phase !== 'CHANNEL' && messages.some((m) => m.cardType && !m.disabled));

  return {
    messages,
    phase,
    config,
    isAnalyzing: analyzeGoal.isPending,
    isCreating: createAgent.isPending,
    createdAgentId,
    sendMessage,
    handleCardResponse,
    inputDisabled,
    refetchChannels: () => { refetchChannels(); },
    channelsFetching,
  };
}
