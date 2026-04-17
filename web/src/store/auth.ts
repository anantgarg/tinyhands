import { create } from 'zustand';

export interface AuthUser {
  userId: string;
  dbUserId?: string;
  slackUserId?: string;
  workspaceId: string;
  homeWorkspaceId?: string;
  displayName: string;
  avatarUrl: string;
  platformRole: 'superadmin' | 'admin' | 'member';
  platformAdmin?: boolean;
  workspaceRole?: 'admin' | 'member' | 'viewer';
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  clearUser: () => void;
  isAdmin: () => boolean;
  isPlatformAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  clearUser: () => set({ user: null, isLoading: false }),
  isAdmin: () => {
    const { user } = get();
    if (!user) return false;
    if (user.platformRole === 'superadmin' || user.platformRole === 'admin') return true;
    return user.workspaceRole === 'admin';
  },
  isPlatformAdmin: () => {
    const { user } = get();
    return !!user?.platformAdmin;
  },
}));
