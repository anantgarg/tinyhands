import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  proposedChanges?: Record<string, { from: unknown; to: unknown }>;
  canApply?: boolean;
  agentId?: string;
}

export interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  selectedAgentId: string | null;
  isLoading: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setSelectedAgentId: (id: string | null) => void;
  addMessage: (message: ChatMessage) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

let messageCounter = 0;

export function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageCounter}`;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: false,
  messages: [],
  selectedAgentId: null,
  isLoading: false,
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  setLoading: (loading) => set({ isLoading: loading }),
  clearMessages: () => set({ messages: [] }),
}));
