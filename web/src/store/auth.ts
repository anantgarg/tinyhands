import { create } from 'zustand';

export interface AuthUser {
  userId: string;
  workspaceId: string;
  displayName: string;
  avatarUrl: string;
  platformRole: 'superadmin' | 'admin' | 'member';
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  clearUser: () => void;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  clearUser: () => set({ user: null, isLoading: false }),
  isAdmin: () => {
    const { user } = get();
    return user?.platformRole === 'superadmin' || user?.platformRole === 'admin';
  },
}));
