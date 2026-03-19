import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface PlatformRole {
  userId: string;
  displayName: string;
  avatarUrl: string;
  role: 'superadmin' | 'admin' | 'member';
  assignedAt: string;
}

export function usePlatformRoles() {
  return useQuery<PlatformRole[]>({
    queryKey: ['access', 'platform-roles'],
    queryFn: () => api.get('/access/platform-roles'),
  });
}

export function useSetPlatformRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.put(`/access/platform-roles/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access', 'platform-roles'] }),
  });
}

export function useRemovePlatformRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.del(`/access/platform-roles/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access', 'platform-roles'] }),
  });
}
