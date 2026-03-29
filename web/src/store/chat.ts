import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposedChanges?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  agentId?: string;
  toolCallsUsed?: string[];
}

interface Conversation {
  id: string;
  agentId: string | null;
  messages: ChatMessage[];
  createdAt: number;
  title: string;
}

export type ModelOverride = 'opus' | 'sonnet' | 'haiku' | null;

export interface ChatState {
  isOpen: boolean;
  isExpanded: boolean;
  messages: ChatMessage[];
  selectedAgentId: string | null;
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  activeToolCalls: Array<{ name: string; label: string }>;
  modelOverride: ModelOverride;
  conversations: Conversation[];
  showHistory: boolean;
  creationMode: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleExpand: () => void;
  setSelectedAgentId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  updateLastMessage: (updates: Partial<ChatMessage>) => void;
  setLoading: (loading: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setActiveToolCalls: (calls: Array<{ name: string; label: string }>) => void;
  addActiveToolCall: (call: { name: string; label: string }) => void;
  clearActiveToolCalls: () => void;
  setModelOverride: (model: ModelOverride) => void;
  clearMessages: () => void;
  newConversation: () => void;
  toggleHistory: () => void;
  loadConversation: (id: string) => void;
  enterCreationMode: () => void;
  exitCreationMode: () => void;
}

let messageCounter = 0;

export function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  isExpanded: false,
  messages: [],
  selectedAgentId: null,
  isLoading: false,
  isStreaming: false,
  streamingContent: '',
  activeToolCalls: [],
  modelOverride: null,
  conversations: [],
  showHistory: false,
  creationMode: false,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, isExpanded: false }),
  toggleExpand: () => set((state) => ({ isExpanded: !state.isExpanded })),
  setSelectedAgentId: (id) => {
    const state = get();
    // Save current conversation before switching
    if (state.messages.length > 0) {
      const existing = state.conversations.find(c =>
        c.agentId === state.selectedAgentId && c.messages.length === state.messages.length
      );
      if (!existing) {
        const title = state.messages[0]?.content?.slice(0, 50) || 'New conversation';
        const conv: Conversation = {
          id: generateConversationId(),
          agentId: state.selectedAgentId,
          messages: [...state.messages],
          createdAt: Date.now(),
          title,
        };
        set({ conversations: [conv, ...state.conversations].slice(0, 20) });
      }
    }
    set({ selectedAgentId: id, messages: [] });
  },
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateLastMessage: (updates) =>
    set((state) => {
      const msgs = [...state.messages];
      if (msgs.length > 0) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...updates };
      }
      return { messages: msgs };
    }),
  setLoading: (loading) => set({ isLoading: loading }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) => set((state) => ({ streamingContent: state.streamingContent + chunk })),
  setActiveToolCalls: (calls) => set({ activeToolCalls: calls }),
  addActiveToolCall: (call) => set((state) => ({ activeToolCalls: [...state.activeToolCalls, call] })),
  clearActiveToolCalls: () => set({ activeToolCalls: [] }),
  setModelOverride: (model) => set({ modelOverride: model }),
  clearMessages: () => set({ messages: [] }),
  newConversation: () => {
    const state = get();
    if (state.messages.length > 0) {
      const title = state.messages[0]?.content?.slice(0, 50) || 'New conversation';
      const conv: Conversation = {
        id: generateConversationId(),
        agentId: state.selectedAgentId,
        messages: [...state.messages],
        createdAt: Date.now(),
        title,
      };
      set({ messages: [], conversations: [conv, ...state.conversations].slice(0, 20) });
    } else {
      set({ messages: [] });
    }
  },
  toggleHistory: () => set((state) => ({ showHistory: !state.showHistory })),
  loadConversation: (id) => {
    const state = get();
    const conv = state.conversations.find(c => c.id === id);
    if (conv) {
      set({ messages: conv.messages, selectedAgentId: conv.agentId, showHistory: false });
    }
  },
  enterCreationMode: () => set({ creationMode: true, isOpen: true, isExpanded: true, messages: [], showHistory: false }),
  exitCreationMode: () => set({ creationMode: false, isExpanded: false, messages: [] }),
}));
