import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  avatarUrl: string;
  isAdmin: boolean;
  isOwner: boolean;
}

export function useSlackUsers() {
  return useQuery<{ users: SlackUser[]; nextCursor: string | null }>({
    queryKey: ['slack', 'users'],
    queryFn: () => api.get('/slack/users?limit=500'),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}
