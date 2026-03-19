import { useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import type { AuthUser } from '@/store/auth';

export function useAuth() {
  const { user, isLoading, setUser, clearUser, isAdmin } = useAuthStore();

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (!res.ok) {
        clearUser();
        return null;
      }
      const data = (await res.json()) as AuthUser;
      setUser(data);
      return data;
    } catch {
      clearUser();
      return null;
    }
  }, [setUser, clearUser]);

  return { user, isLoading, checkAuth, clearUser, isAdmin: isAdmin() };
}
