import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface WebChat {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  agentModel: string;
  username: string;
  password: string;
  publicToken: string;
  enabled: boolean;
  createdAt: string;
}

interface CreateWebChatPayload {
  name: string;
  agentId: string;
  username: string;
  password: string;
}

interface UpdateWebChatPayload {
  id: string;
  name?: string;
  agentId?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
}

export function useWebChats() {
  return useQuery<WebChat[]>({
    queryKey: ['web-chats'],
    queryFn: () => api.get('/web-chat/channels'),
  });
}

export function useCreateWebChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWebChatPayload) => api.post('/web-chat/channels', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-chats'] }),
  });
}

export function useUpdateWebChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateWebChatPayload) => api.patch(`/web-chat/channels/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-chats'] }),
  });
}

export function useDeleteWebChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/web-chat/channels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['web-chats'] }),
  });
}
