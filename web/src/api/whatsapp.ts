import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface WhatsAppAllowedNumber {
  id?: string;
  number: string;
  label: string | null;
}

export interface WhatsAppChannel {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  agentModel: string;
  accountSidMasked: string;
  authTokenConfigured: boolean;
  whatsappNumber: string;
  allowedNumbers: WhatsAppAllowedNumber[];
  allowedCount: number;
  enabled: boolean;
  createdAt: string;
}

interface CreateWhatsAppPayload {
  name: string;
  agentId: string;
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  allowedNumbers: WhatsAppAllowedNumber[];
}

interface UpdateWhatsAppPayload {
  id: string;
  name?: string;
  agentId?: string;
  accountSid?: string;
  authToken?: string;
  whatsappNumber?: string;
  enabled?: boolean;
  allowedNumbers?: WhatsAppAllowedNumber[];
}

export function useWhatsAppChannels() {
  return useQuery<WhatsAppChannel[]>({
    queryKey: ['whatsapp-channels'],
    queryFn: () => api.get('/whatsapp/channels'),
  });
}

export function useCreateWhatsAppChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWhatsAppPayload) => api.post('/whatsapp/channels', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-channels'] }),
  });
}

export function useUpdateWhatsAppChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateWhatsAppPayload) => api.patch(`/whatsapp/channels/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-channels'] }),
  });
}

export function useDeleteWhatsAppChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/whatsapp/channels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whatsapp-channels'] }),
  });
}
