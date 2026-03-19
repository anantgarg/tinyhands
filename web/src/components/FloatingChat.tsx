import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, X, ChevronDown, Sparkles, Command } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderEmoji } from '@/lib/emoji';
import { useChatStore, generateMessageId } from '@/store/chat';
import { useAgents, useUpdateAgent } from '@/api/agents';
import { api } from '@/api/client';

interface ChatResponse {
  response: string;
  proposedChanges?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
}

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

export function FloatingChat() {
  const location = useLocation();
  const {
    isOpen,
    messages,
    selectedAgentId,
    isLoading,
    toggle,
    close,
    setSelectedAgentId,
    addMessage,
    setLoading,
    clearMessages,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const collapsedInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: agents } = useAgents();
  const updateAgent = useUpdateAgent();

  // Detect page context and auto-set agent
  const { agentId: pageAgentId, context: pageContext } = getPageContext(location.pathname);
  const currentAgent = agents?.find(
    (a) => a.id === (selectedAgentId || pageAgentId),
  );

  // Auto-set agent context when navigating to an agent page
  useEffect(() => {
    if (pageAgentId && pageAgentId !== selectedAgentId) {
      setSelectedAgentId(pageAgentId);
    }
  }, [pageAgentId, selectedAgentId, setSelectedAgentId]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, close, isOpen]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;

    const userMessage = {
      id: generateMessageId(),
      role: 'user' as const,
      content: trimmed,
    };
    addMessage(userMessage);
    setInputValue('');
    setLoading(true);

    try {
      const agentId = selectedAgentId || pageAgentId;
      const result = await api.post<ChatResponse>('/chat', {
        message: trimmed,
        agentId: agentId || undefined,
        context: pageContext,
      });

      addMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: result.response,
        proposedChanges: result.proposedChanges,
        canApply: result.canApply,
        agentId: agentId || undefined,
      });
    } catch (err: any) {
      addMessage({
        id: generateMessageId(),
        role: 'assistant',
        content: `Something went wrong: ${err.message || 'Unknown error'}. Please try again.`,
      });
    } finally {
      setLoading(false);
    }
  }, [
    inputValue,
    isLoading,
    selectedAgentId,
    pageAgentId,
    pageContext,
    addMessage,
    setLoading,
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
      sendMessage();
    }
  };

  const handleCollapsedFocus = () => {
    if (!isOpen) {
      toggle();
    }
  };

  const placeholder = getPlaceholder(pageContext, currentAgent?.name);

  // Collapsed bar
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 left-1/2 z-50 w-full max-w-xl -translate-x-1/2 px-4">
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

  // Expanded panel
  return (
    <div
      ref={panelRef}
      className="fixed bottom-6 left-1/2 z-50 flex w-full max-w-xl -translate-x-1/2 flex-col rounded-2xl border border-[#E0DED9] bg-white px-4 shadow-lg"
      style={{ maxHeight: '500px' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E0DED9] px-1 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" />
          <span className="text-sm font-semibold text-warm-text">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent selector */}
          <div className="relative">
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-1 py-3 space-y-3" style={{ maxHeight: '360px', minHeight: '120px' }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <p className="text-xs text-warm-text-secondary/60">
              {currentAgent
                ? `Ask questions or describe changes for "${currentAgent.name}"`
                : 'Select an agent to update, or ask a general question'}
            </p>
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
              <p className="whitespace-pre-wrap">{msg.content}</p>

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

        {isLoading && (
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
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-transparent text-sm text-warm-text placeholder:text-warm-text-secondary/50 outline-none"
            disabled={isLoading}
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
            disabled={!inputValue.trim() || isLoading}
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
