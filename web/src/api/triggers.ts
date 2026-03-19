import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface Trigger {
  id: string;
  agentId: string;
  agentName: string;
  type: 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook' | 'schedule';
  config: Record<string, unknown>;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface CreateTriggerPayload {
  agentId: string;
  type: string;
  config: Record<string, unknown>;
  enabled?: boolean;
}

interface UpdateTriggerPayload {
  id: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export function useTriggers() {
  return useQuery<Trigger[]>({
    queryKey: ['triggers'],
    queryFn: () => api.get('/triggers'),
  });
}

export function useCreateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTriggerPayload) => api.post('/triggers', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}

export function useUpdateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateTriggerPayload) => api.patch(`/triggers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}

export function useDeleteTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/triggers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers'] }),
  });
}
