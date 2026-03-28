import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposedChanges?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  agentId?: string;
}

interface Conversation {
  id: string;
  agentId: string | null;
  messages: ChatMessage[];
  createdAt: number;
  title: string;
}

export interface ChatState {
  isOpen: boolean;
  isExpanded: boolean;
  messages: ChatMessage[];
  selectedAgentId: string | null;
  isLoading: boolean;
  conversations: Conversation[];
  showHistory: boolean;
  creationMode: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleExpand: () => void;
  setSelectedAgentId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  setLoading: (loading: boolean) => void;
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
  setLoading: (loading) => set({ isLoading: loading }),
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
