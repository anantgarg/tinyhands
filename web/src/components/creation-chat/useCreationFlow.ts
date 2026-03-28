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
  | 'schedule';

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
  });
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null);
  const goalRef = useRef('');
  const skipPhasesRef = useRef<Set<Phase>>(new Set());

  const analyzeGoal = useAnalyzeGoal();
  const createAgent = useCreateAgent();
  const addTrigger = useAddAgentTrigger();
  const { data: availableTools } = useAvailableTools();
  const { data: channelsData } = useSlackChannels();

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

  const goToChannel = useCallback(() => {
    setPhase('CHANNEL');
    const channelOptions = channels.map((ch) => ({
      value: ch.id,
      label: `#${ch.name}`,
    }));
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Which Slack channel should this agent live in? We\'ll create a new one if you prefer, or pick an existing channel.',
      cardType: 'dropdown',
      cardProps: {
        options: channelOptions.length > 0 ? channelOptions : [{ value: '__new__', label: 'Create a new channel (automatic)' }],
        placeholder: 'Search for a channel...',
        searchable: true,
      },
    });
  }, [channels, addMsg]);

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
    const options = integrationGroups.map((g) => ({
      value: g.base,
      label: g.displayName,
      readToolName: g.readTool,
      writeToolName: g.writeTool,
      hasWrite: !!g.writeTool,
    }));
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: integrationGroups.length > 0
        ? 'Which services should this agent have access to? Core tools like file access, web search, and code analysis are always included.'
        : 'No connected services are available right now. Core tools (file access, web search, code analysis) will be included automatically. You can add services later from the agent settings.',
      cardType: 'multi-select',
      cardProps: {
        options,
        defaultValues: config.tools || [],
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
          { value: 'member', label: 'Full Access', description: 'Everyone in the workspace can use and configure this agent', recommended: true },
          { value: 'viewer', label: 'Limited Access', description: 'Everyone can use it, but only owners can change settings' },
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
    };
    addMsg({
      id: msgId(),
      role: 'assistant',
      content: 'Here\'s what we\'ve got. Take a look and let me know if everything looks good!',
      cardType: 'confirmation',
      cardProps: { config: confirmConfig },
    });
  }, [addMsg, config]);

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
          onSuccess: (result) => {
            const name = result.name || 'New Agent';
            const emoji = result.avatarEmoji || '';
            const prompt = result.systemPrompt || '';
            const model = result.model?.includes('opus') ? 'opus' : result.model?.includes('haiku') ? 'haiku' : 'sonnet';
            const tools = [...(result.tools || [])];
            const memory = result.memoryEnabled ?? false;
            const mentions = result.mentionsOnly ?? false;

            setConfig((prev) => ({
              ...prev,
              name,
              avatarEmoji: emoji,
              systemPrompt: prompt,
              model,
              tools,
              memoryEnabled: memory,
              activation: mentions ? 'mentions' : 'relevant',
            }));

            // Decide which phases to skip based on analysis
            const skips = new Set<Phase>();
            // Always show effort and memory since analyzer provides them
            skips.add('EFFORT');
            skips.add('MEMORY');
            // Skip schedule ask if no time pattern detected
            if (!hasTimePattern(trimmed)) {
              skips.add('SCHEDULE_ASK');
            }
            // Skip approval if no write tools
            if (!hasWriteTools(tools)) {
              skips.add('APPROVAL');
            }
            skipPhasesRef.current = skips;

            const toolNames = tools
              .map((t: string) => BUILTIN_FRIENDLY_NAMES[t] || t.replace(/-read$/, '').replace(/-write$/, ''))
              .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);

            let summary = `Great! Here's what I'm thinking:\n\n`;
            summary += `**${emoji} ${name}**\n`;
            summary += `Model: ${model.charAt(0).toUpperCase() + model.slice(1)}\n`;
            if (toolNames.length > 0) {
              summary += `Services: ${toolNames.join(', ')}\n`;
            }
            summary += `Memory: ${memory ? 'Enabled' : 'Disabled'}\n`;
            summary += `\nLet's pick a channel for it.`;

            addMsg({ id: msgId(), role: 'assistant', content: summary });
            goToChannel();
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
    [phase, analyzeGoal, addMsg, config.model, goToChannel, goToActivation, goToTools, goToEffort, goToMemory, goToAccess, goToApproval, goToConfirm, goToSchedule],
  );

  // ── Handle card responses ──

  const handleCardResponse = useCallback(
    (_messageId: string, response: unknown) => {
      disableLastCard();

      switch (phase) {
        case 'CHANNEL': {
          const channelId = response as string;
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
              content: 'What would you like to change? You can say things like "change the name", "update the model", "add more tools", etc.',
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
      goToEffort, goToMemory, goToAccess, goToApproval, goToConfirm, doCreate,
    ],
  );

  const inputDisabled =
    phase === 'ANALYZING' ||
    phase === 'CREATING' ||
    phase === 'DONE' ||
    (phase !== 'DESCRIBE' && phase !== 'CHANGE_REQUEST' && messages.some((m) => m.cardType && !m.disabled));

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
  };
}
