import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface EvolutionProposal {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string;
  action: string;
  description: string;
  diff: string;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  createdAt: string;
  resolvedAt: string | null;
}

interface EvolutionParams {
  status?: string;
  agentId?: string;
  page?: number;
  limit?: number;
}

export function useEvolutionProposals(params?: EvolutionParams) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.agentId) searchParams.set('agentId', params.agentId);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();

  return useQuery<{ proposals: EvolutionProposal[]; total: number }>({
    queryKey: ['evolution', params],
    queryFn: () => api.get(`/evolution/proposals${qs ? `?${qs}` : ''}`),
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/evolution/proposals/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evolution'] }),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/evolution/proposals/${id}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evolution'] }),
  });
}
