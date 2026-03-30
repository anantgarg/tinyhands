import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, X, ChevronDown, Sparkles, Command, Plus, Clock, Maximize2, Minimize2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderEmoji } from '@/lib/emoji';
import { useChatStore, generateMessageId } from '@/store/chat';
import type { ModelOverride } from '@/store/chat';
import { useAgents, useUpdateAgent } from '@/api/agents';
import { formatDistanceToNow } from 'date-fns';
import { useCreationFlow } from './creation-chat/useCreationFlow';
import type { CreationMessage } from './creation-chat/useCreationFlow';
import {
  MultiChoiceCard,
  YesNoCard,
  DropdownCard,
  MultiSelectCard,
  ConfirmationCard,
  ScheduleCard,
  PromptPreviewCard,
} from './creation-chat/cards';
import type { ConfirmationConfig } from './creation-chat/cards/ConfirmationCard';

function getPageContext(pathname: string): { agentId: string | null; context: string } {
  const agentMatch = pathname.match(/^\/agents\/([^/]+)$/);
  if (agentMatch && agentMatch[1] !== 'new' && agentMatch[1] !== 'templates') {
    return { agentId: agentMatch[1], context: 'agent' };
  }
  if (pathname === '/' || pathname === '') {
    return { agentId: null, context: 'dashboard' };
  }
  if (pathname.startsWith('/tools')) {
    return { agentId: null, context: 'tools' };
  }
  if (pathname.startsWith('/kb')) {
    return { agentId: null, context: 'kb' };
  }
  return { agentId: null, context: 'general' };
}

function getPlaceholder(context: string, agentName?: string): string {
  if (context === 'agent' && agentName) {
    return `Chat about ${agentName}...`;
  }
  return 'Ask anything or update an agent...';
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || '(none)';
  if (typeof value === 'string') {
    if (value.length > 80) return value.slice(0, 80) + '...';
    return value;
  }
  return String(value);
}

// ── Parse model override from message (e.g., "/opus why is this failing?") ──

function parseModelOverride(text: string): { model: ModelOverride; cleanText: string } {
  const match = text.match(/^\/(opus|sonnet|haiku)\s+/i);
  if (match) {
    return {
      model: match[1].toLowerCase() as ModelOverride,
      cleanText: text.slice(match[0].length),
    };
  }
  return { model: null, cleanText: text };
}

// ── Detect creation intent ──

function isCreationIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return /^(create|make|build|set up|setup|start|new)\s+(a\s+)?(new\s+)?agent/i.test(lower);
}

// ── Card renderer for creation mode ──

function CreationCardRenderer({
  msg,
  onCardResponse,
  isCreating,
  onRefreshChannels,
  channelsRefreshing,
}: {
  msg: CreationMessage;
  onCardResponse: (messageId: string, response: unknown) => void;
  isCreating: boolean;
  onRefreshChannels?: () => void;
  channelsRefreshing?: boolean;
}) {
  if (!msg.cardType) return null;

  const props = msg.cardProps || {};

  switch (msg.cardType) {
    case 'multi-choice':
      return (
        <MultiChoiceCard
          options={props.options as { value: string; label: string; description?: string; recommended?: boolean }[]}
          defaultValue={props.defaultValue as string | undefined}
          onSubmit={(value) => onCardResponse(msg.id, value)}
          disabled={msg.disabled}
        />
      );
    case 'yes-no':
      return (
        <YesNoCard
          question={props.question as string | undefined}
          description={props.description as string | undefined}
          yesLabel={props.yesLabel as string | undefined}
          noLabel={props.noLabel as string | undefined}
          defaultValue={props.defaultValue as boolean | undefined}
          onSubmit={(value) => onCardResponse(msg.id, value)}
          disabled={msg.disabled}
        />
      );
    case 'dropdown':
      return (
        <DropdownCard
          options={props.options as { value: string; label: string }[]}
          searchable={props.searchable as boolean | undefined}
          placeholder={props.placeholder as string | undefined}
          defaultValue={props.defaultValue as string | undefined}
          onSubmit={(value) => onCardResponse(msg.id, value)}
          disabled={msg.disabled}
          helpText={props.helpText as string | undefined}
          onRefresh={props.helpText ? onRefreshChannels : undefined}
          refreshing={channelsRefreshing}
        />
      );
    case 'multi-select':
      return (
        <MultiSelectCard
          options={props.options as { value: string; label: string; icon?: string; hasWrite?: boolean; readToolName?: string; writeToolName?: string }[]}
          defaultValues={props.defaultValues as string[] | undefined}
          onSubmit={(values) => onCardResponse(msg.id, values)}
          disabled={msg.disabled}
        />
      );
    case 'confirmation': {
      const config = props.config as ConfirmationConfig;
      return (
        <ConfirmationCard
          config={config}
          onConfirm={() => onCardResponse(msg.id, 'confirm')}
          onChange={() => onCardResponse(msg.id, 'change')}
          isCreating={isCreating}
          disabled={msg.disabled}
        />
      );
    }
    case 'schedule':
      return (
        <ScheduleCard
          defaultFrequency={props.defaultFrequency as string | undefined}
          defaultTimezone={props.defaultTimezone as string | undefined}
          onSubmit={(cron, timezone) => onCardResponse(msg.id, { cron, timezone })}
          disabled={msg.disabled}
        />
      );
    case 'prompt-preview':
      return (
        <PromptPreviewCard
          prompt={props.prompt as string}
          onSubmit={(response) => onCardResponse(msg.id, response)}
          disabled={msg.disabled}
        />
      );
    default:
      return null;
  }
}

// ── Markdown renderer (bold, bullets, code spans, line breaks) ──

function renderContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const isBullet = /^[\u2022\-\*]\s/.test(line);
    const bulletContent = isBullet ? line.replace(/^[\u2022\-\*]\s/, '') : line;

    // Parse inline formatting: **bold** and `code`
    const parts = (isBullet ? bulletContent : line).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    const rendered = parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
      }
      return part;
    });

    if (isBullet) {
      return (
        <span key={lineIdx} className="flex gap-1.5 items-start">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warm-text-secondary/50" />
          <span>{rendered}</span>
        </span>
      );
    }

    return (
      <span key={lineIdx}>
        {lineIdx > 0 && <br />}
        {rendered}
      </span>
    );
  });
}

// ── SSE stream reader ──

interface StreamEvent {
  type: 'text' | 'tool_call' | 'proposed_changes' | 'done' | 'error';
  content?: string;
  name?: string;
  label?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  toolCallsUsed?: string[];
}

export function FloatingChat() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    isOpen,
    isExpanded,
    messages,
    selectedAgentId,
    isLoading,
    isStreaming,
    streamingContent,
    activeToolCalls,
    modelOverride,
    toggle,
    close,
    toggleExpand,
    setSelectedAgentId,
    addMessage,
    setLoading,
    setStreaming,
    setStreamingContent,
    appendStreamingContent,
    addActiveToolCall,
    clearActiveToolCalls,
    setModelOverride,
    clearMessages,
    newConversation,
    showHistory,
    toggleHistory,
    conversations,
    loadConversation,
    creationMode,
    enterCreationMode,
    exitCreationMode,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const creationMessagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const collapsedInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { data: agents } = useAgents();
  const updateAgent = useUpdateAgent();

  // Creation flow hook (always called but only active in creation mode)
  const creationFlow = useCreationFlow();

  // Detect page context and auto-set agent
  const { agentId: pageAgentId, context: pageContext } = getPageContext(location.pathname);
  const currentAgent = agents?.find(
    (a) => a.id === (selectedAgentId || pageAgentId),
  );

  // Auto-set agent context when navigating to an agent page — start fresh convo
  useEffect(() => {
    if (creationMode) return;
    if (pageAgentId && pageAgentId !== selectedAgentId) {
      setSelectedAgentId(pageAgentId);
      if (messages.length > 0) {
        newConversation();
      }
    }
  }, [pageAgentId, selectedAgentId, setSelectedAgentId, messages.length, newConversation, creationMode]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (creationMode) return;
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        if (creationMode) {
          exitCreationMode();
        } else {
          close();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, close, isOpen, creationMode, exitCreationMode, navigate]);

  // Scroll to bottom on new messages (regular chat)
  useEffect(() => {
    if (!creationMode) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, activeToolCalls, creationMode]);

  // Scroll to bottom on new creation messages
  useEffect(() => {
    if (creationMode) {
      creationMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [creationFlow.messages, creationMode]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Navigate to agent detail when creation is done
  useEffect(() => {
    if (creationFlow.createdAgentId && creationMode) {
      const timer = setTimeout(() => {
        exitCreationMode();
        navigate(`/agents/${creationFlow.createdAgentId}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [creationFlow.createdAgentId, creationMode, exitCreationMode, navigate]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading || isStreaming) return;

    // Check for creation intent
    if (isCreationIntent(trimmed) && !creationMode) {
      setInputValue('');
      enterCreationMode();
      return;
    }

    // Parse model override prefix
    const { model: msgModelOverride, cleanText } = parseModelOverride(trimmed);
    if (msgModelOverride) {
      setModelOverride(msgModelOverride);
    }
    const effectiveModel = msgModelOverride || modelOverride;

    const userMessage = {
      id: generateMessageId(),
      role: 'user' as const,
      content: cleanText || trimmed,
    };
    addMessage(userMessage);
    setInputValue('');
    setLoading(true);
    setStreaming(true);
    setStreamingContent('');
    clearActiveToolCalls();

    // Build conversation history for the API (role + content only)
    const conversationHistory = [...messages, userMessage].map(m => ({
      role: m.role,
      content: m.content,
    }));

    const agentId = selectedAgentId || pageAgentId;

    try {
      // Abort any previous stream
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: conversationHistory,
          agentId: agentId || undefined,
          context: pageContext,
          modelOverride: effectiveModel || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let proposedChanges: Record<string, { from: unknown; to: unknown }> | undefined;
      let canApply: boolean | undefined;
      let toolCallsUsed: string[] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'text':
                fullText += event.content || '';
                appendStreamingContent(event.content || '');
                break;
              case 'tool_call':
                addActiveToolCall({ name: event.name || '', label: event.label || '' });
                break;
              case 'proposed_changes':
                proposedChanges = event.changes;
                canApply = event.canApply;
                break;
              case 'done':
                toolCallsUsed = event.toolCallsUsed;
                break;
              case 'error':
                fullText = event.content || 'Something went wrong. Please try again.';
                break;
            }
          } catch {
            // Invalid JSON line — skip
          }
        }
      }

      // Finalize: add the complete assistant message
      addMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: fullText,
        proposedChanges,
        canApply,
        agentId: agentId || undefined,
        toolCallsUsed,
      });
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      addMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `Something went wrong: ${err.message || 'Unknown error'}. Please try again.`,
      });
    } finally {
      setLoading(false);
      setStreaming(false);
      setStreamingContent('');
      clearActiveToolCalls();
    }
  }, [
    inputValue,
    isLoading,
    isStreaming,
    selectedAgentId,
    pageAgentId,
    pageContext,
    messages,
    modelOverride,
    creationMode,
    addMessage,
    setLoading,
    setStreaming,
    setStreamingContent,
    appendStreamingContent,
    clearActiveToolCalls,
    addActiveToolCall,
    setModelOverride,
    enterCreationMode,
  ]);

  const handleApplyChanges = useCallback(
    async (msgAgentId: string, proposedChanges: Record<string, { from: unknown; to: unknown }>) => {
      setLoading(true);
      try {
        const updates: Record<string, unknown> = {};
        for (const [key, change] of Object.entries(proposedChanges)) {
          updates[key] = change.to;
        }

        await updateAgent.mutateAsync({ id: msgAgentId, ...updates });

        addMessage({
          id: generateMessageId(),
          role: 'assistant',
          content: 'Changes applied successfully! The agent has been updated.',
        });
      } catch (err: any) {
        addMessage({
          id: generateMessageId(),
          role: 'assistant',
          content: `Failed to apply changes: ${err.message || 'Unknown error'}`,
        });
      } finally {
        setLoading(false);
      }
    },
    [updateAgent, addMessage, setLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (creationMode) {
        if (!creationFlow.inputDisabled && inputValue.trim()) {
          creationFlow.sendMessage(inputValue.trim());
          setInputValue('');
        }
      } else {
        sendMessage();
      }
    }
  };

  const handleCollapsedFocus = () => {
    if (!isOpen) {
      toggle();
    }
  };

  const handleCreationSend = () => {
    if (creationFlow.inputDisabled || !inputValue.trim()) return;
    creationFlow.sendMessage(inputValue.trim());
    setInputValue('');
  };

  const placeholder = creationMode
    ? (creationFlow.inputDisabled ? 'Choose an option above...' : 'Describe what your agent should do...')
    : getPlaceholder(pageContext, currentAgent?.name);

  // ── Context-aware suggestions ──

  const suggestions = currentAgent
    ? [
        'Why is this agent failing?',
        'Show recent errors',
        'Improve instructions',
        'Change the model',
      ]
    : [
        'Create a new agent',
        'Which agent has the most errors?',
        'Show overall usage',
      ];

  // Collapsed bar (hidden during creation mode)
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 px-4 sm:w-full">
        <div
          className="flex cursor-pointer items-center gap-3 rounded-full border border-[#E0DED9] bg-white px-5 py-3 shadow-lg transition-all hover:shadow-xl hover:border-[#D0CEC9]"
          onClick={handleCollapsedFocus}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleCollapsedFocus();
          }}
        >
          <Sparkles className="h-4 w-4 shrink-0 text-brand" />
          <input
            ref={collapsedInputRef}
            type="text"
            className="flex-1 bg-transparent text-sm text-warm-text-secondary placeholder:text-warm-text-secondary/60 outline-none cursor-pointer"
            placeholder={placeholder}
            readOnly
            tabIndex={-1}
          />
          <div className="flex items-center gap-1 rounded-md border border-[#E0DED9] px-1.5 py-0.5 text-[11px] text-warm-text-secondary">
            <Command className="h-3 w-3" />
            <span>K</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Creation mode panel ──
  if (creationMode) {
    return (
      <div
        ref={panelRef}
        className="fixed bottom-0 right-0 z-50 flex flex-col bg-white shadow-lg transition-all sm:bottom-6 sm:right-6 sm:max-w-[640px] sm:rounded-2xl sm:border sm:border-[#E0DED9]"
        style={{ height: 'min(80vh, 700px)', width: '100%', maxWidth: '640px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E0DED9] px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-warm-text">Create Agent</span>
          </div>
          <button
            onClick={() => exitCreationMode()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {creationFlow.messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300',
                msg.role === 'user' ? 'items-end' : 'items-start',
              )}
            >
              <div
                className={cn(
                  'max-w-[90%] rounded-2xl px-3.5 py-2 text-sm',
                  msg.role === 'user'
                    ? 'bg-[#E7F5EE] text-warm-text'
                    : 'border border-[#E0DED9] bg-white text-warm-text',
                )}
              >
                <p className="whitespace-pre-wrap">{renderContent(msg.content)}</p>
              </div>
              {msg.cardType && (
                <div className="w-full mt-2">
                  <CreationCardRenderer
                    msg={msg}
                    onCardResponse={creationFlow.handleCardResponse}
                    isCreating={creationFlow.isCreating}
                    onRefreshChannels={creationFlow.refetchChannels}
                    channelsRefreshing={creationFlow.channelsFetching}
                  />
                </div>
              )}
            </div>
          ))}

          {creationFlow.isAnalyzing && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-[#E0DED9] bg-white px-3.5 py-2">
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={creationMessagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-[#E0DED9] px-4 py-3">
          <div className="flex items-center gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              className="flex-1 bg-transparent text-sm text-warm-text placeholder:text-warm-text-secondary/50 outline-none disabled:cursor-not-allowed resize-none"
              disabled={creationFlow.inputDisabled}
            />
            <button
              onClick={handleCreationSend}
              disabled={!inputValue.trim() || creationFlow.inputDisabled}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Regular chat panel ──
  return (
    <div
      ref={panelRef}
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col rounded-2xl border border-[#E0DED9] bg-white px-4 shadow-lg w-[calc(100%-2rem)] sm:w-full max-w-xl transition-[max-height] duration-200"
      style={{ maxHeight: isExpanded ? '80vh' : '500px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E0DED9] px-1 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-warm-text">AI Assistant</span>
          {/* Model override badge */}
          {modelOverride && (
            <button
              onClick={() => setModelOverride(null)}
              className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand hover:bg-brand/20 transition-colors"
              title="Click to clear model override"
            >
              <Zap className="h-2.5 w-2.5" />
              {modelOverride.charAt(0).toUpperCase() + modelOverride.slice(1)}
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* New Chat button */}
          <button
            onClick={newConversation}
            className="flex h-6 w-6 items-center justify-center rounded-md text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text transition-colors"
            title="New Chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {/* History button */}
          <button
            onClick={toggleHistory}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
              showHistory ? 'bg-warm-bg text-brand' : 'text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text',
            )}
            title="History"
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          {/* Expand button */}
          <button
            onClick={toggleExpand}
            className="flex h-6 w-6 items-center justify-center rounded-md text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text transition-colors"
            title={isExpanded ? 'Minimize' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          {/* Agent selector */}
          <div className="relative ml-1">
            <button
              onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
              className="flex items-center gap-1.5 rounded-lg border border-[#E0DED9] px-2.5 py-1 text-xs text-warm-text-secondary hover:bg-warm-bg transition-colors"
            >
              <span className="max-w-[120px] truncate">
                {currentAgent ? currentAgent.name : 'No agent'}
              </span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {agentDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-[#E0DED9] bg-white py-1 shadow-lg z-[60]">
                <button
                  onClick={() => {
                    setSelectedAgentId(null);
                    newConversation();
                    setAgentDropdownOpen(false);
                  }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs hover:bg-warm-bg transition-colors',
                    !selectedAgentId && !pageAgentId
                      ? 'text-brand font-medium'
                      : 'text-warm-text-secondary',
                  )}
                >
                  No agent (general)
                </button>
                {agents?.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      if (selectedAgentId !== agent.id) {
                        newConversation();
                      }
                      setSelectedAgentId(agent.id);
                      setAgentDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-xs hover:bg-warm-bg transition-colors',
                      (selectedAgentId || pageAgentId) === agent.id
                        ? 'text-brand font-medium'
                        : 'text-warm-text-secondary',
                    )}
                  >
                    <span className="mr-1.5">{renderEmoji(agent.avatarEmoji)}</span>
                    {agent.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Close button */}
          <button
            onClick={close}
            className="flex h-6 w-6 items-center justify-center rounded-md text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages / History */}
      <div className="relative flex-1 overflow-y-auto px-1 py-3 space-y-3" style={{ maxHeight: isExpanded ? 'calc(80vh - 120px)' : '360px', minHeight: '120px' }}>
        {/* History overlay */}
        {showHistory && (
          <div className="absolute inset-0 z-10 bg-white rounded-lg overflow-y-auto p-3">
            <p className="text-xs font-semibold text-warm-text-secondary uppercase tracking-wider mb-3">Conversation History</p>
            {conversations.length === 0 ? (
              <p className="text-xs text-warm-text-secondary/60 text-center py-6">
                No previous conversations
              </p>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className="w-full text-left rounded-lg border border-[#E0DED9] p-2.5 hover:bg-warm-bg transition-colors"
                  >
                    <p className="text-sm font-medium text-warm-text truncate">{conv.title}</p>
                    <p className="text-[11px] text-warm-text-secondary mt-0.5">
                      {conv.messages.length} messages
                      {' \u00b7 '}
                      {formatDistanceToNow(new Date(conv.createdAt), { addSuffix: true })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && !showHistory && (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <p className="text-xs text-warm-text-secondary/60">
              {currentAgent
                ? `Ask questions or diagnose issues with "${currentAgent.name}"`
                : 'Ask anything about your agents or workspace'}
            </p>
            <div className="flex flex-wrap gap-1.5 justify-center max-w-[320px]">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    if (suggestion === 'Create a new agent') {
                      enterCreationMode();
                    } else {
                      setInputValue(suggestion);
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }
                  }}
                  className="rounded-full border border-[#E0DED9] px-2.5 py-1 text-[11px] text-warm-text-secondary hover:bg-warm-bg hover:text-warm-text transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-[#E7F5EE] text-warm-text'
                  : 'border border-[#E0DED9] bg-white text-warm-text',
              )}
            >
              <div className="whitespace-pre-wrap">{renderContent(msg.content)}</div>

              {/* Tool calls used indicator */}
              {msg.toolCallsUsed && msg.toolCallsUsed.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {msg.toolCallsUsed.map((tool, i) => (
                    <span key={i} className="rounded-full bg-brand/5 px-2 py-0.5 text-[10px] text-brand/70">
                      {tool}
                    </span>
                  ))}
                </div>
              )}

              {/* Proposed changes diff */}
              {msg.proposedChanges && Object.keys(msg.proposedChanges).length > 0 && (
                <div className="mt-2.5 space-y-1.5 rounded-lg border border-[#E0DED9] bg-warm-bg p-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-warm-text-secondary/60">
                    Proposed Changes
                  </p>
                  {Object.entries(msg.proposedChanges).map(([key, change]) => (
                    <div key={key} className="text-xs">
                      <span className="font-medium text-warm-text">{key}: </span>
                      <span className="text-red-600 line-through">
                        {formatValue(change.from)}
                      </span>
                      {' '}
                      <span className="text-green-700">
                        {formatValue(change.to)}
                      </span>
                    </div>
                  ))}
                  {msg.canApply && msg.agentId && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() =>
                          handleApplyChanges(msg.agentId!, msg.proposedChanges!)
                        }
                        disabled={isLoading}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
                      >
                        Apply Changes
                      </button>
                      <button
                        onClick={() =>
                          addMessage({
                            id: generateMessageId(),
                            role: 'assistant',
                            content: 'Changes cancelled. Feel free to ask for different modifications.',
                          })
                        }
                        className="rounded-lg border border-[#E0DED9] px-3 py-1.5 text-xs text-warm-text-secondary hover:bg-warm-bg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Streaming content + tool call indicators */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-[#E0DED9] bg-white px-3.5 py-2 text-sm text-warm-text">
              {streamingContent ? (
                <div className="whitespace-pre-wrap">{renderContent(streamingContent)}</div>
              ) : activeToolCalls.length > 0 ? (
                <div className="flex items-center gap-2 text-warm-text-secondary">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-xs">{activeToolCalls[activeToolCalls.length - 1]?.label}</span>
                </div>
              ) : (
                <div className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              {/* Show tool calls below streaming content */}
              {streamingContent && activeToolCalls.length > 0 && (
                <div className="mt-1.5 flex items-center gap-2 text-warm-text-secondary">
                  <div className="flex gap-1">
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '0ms' }} />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '150ms' }} />
                    <span className="h-1 w-1 animate-bounce rounded-full bg-brand/40" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-[10px]">{activeToolCalls[activeToolCalls.length - 1]?.label}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading && !isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[#E0DED9] bg-white px-3.5 py-2">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-warm-text-secondary/40" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#E0DED9] px-1 py-3">
        <div className="flex items-center gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
            onKeyDown={handleKeyDown}
            placeholder={modelOverride ? `Using ${modelOverride.charAt(0).toUpperCase() + modelOverride.slice(1)} — type a message...` : 'Type a message...'}
            rows={1}
            className="flex-1 bg-transparent text-sm text-warm-text placeholder:text-warm-text-secondary/50 outline-none resize-none"
            disabled={isLoading || isStreaming}
          />
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-[10px] text-warm-text-secondary/50 hover:text-warm-text-secondary transition-colors whitespace-nowrap"
            >
              Clear
            </button>
          )}
          <button
            onClick={sendMessage}
            disabled={!inputValue.trim() || isLoading || isStreaming}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
