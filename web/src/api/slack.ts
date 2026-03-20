import { useQuery } from '@tanstack/react-query';
import { api } from './client';

interface SlackUser {
  id: string;
  name: string;
  realName: string;
  displayName: string;
  avatarUrl: string;
  isAdmin: boolean;
  isOwner: boolean;
}

interface SlackUsersResponse {
  users: SlackUser[];
  nextCursor: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
  numMembers: number;
  topic: string;
  purpose: string;
}

interface SlackChannelsResponse {
  channels: SlackChannel[];
  nextCursor: string | null;
}

export function useSlackUsers() {
  return useQuery<SlackUsersResponse>({
    queryKey: ['slack-users'],
    queryFn: () => api.get('/slack/users'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSlackChannels() {
  return useQuery<SlackChannelsResponse>({
    queryKey: ['slack-channels'],
    queryFn: () => api.get('/slack/channels'),
    staleTime: 5 * 60 * 1000,
  });
}
