import { useAuthStore } from '@/store/auth';

export function useWorkspaceId() {
  const user = useAuthStore((state) => state.user);
  return user?.workspaceId ?? '';
}
