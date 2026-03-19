import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  channels: string[];
  memoryEnabled: boolean;
  status: string;
  maxTurns: number;
  respondTo: string;
  defaultAccess: string;
  writePolicy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateAgentPayload {
  name: string;
  avatar?: string;
  systemPrompt: string;
  model?: string;
  tools?: string[];
  channels?: string[];
  memoryEnabled?: boolean;
  maxTurns?: number;
  respondTo?: string;
  defaultAccess?: string;
  writePolicy?: string;
}

interface UpdateAgentPayload extends Partial<CreateAgentPayload> {
  id: string;
}

interface AgentVersion {
  version: number;
  systemPrompt: string;
  model: string;
  tools: string[];
  changedBy: string;
  changedAt: string;
}

interface Run {
  id: string;
  agentId: string;
  traceId: string;
  userId: string;
  status: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

interface Memory {
  id: string;
  agentId: string;
  fact: string;
  category: string;
  relevance: number;
  createdAt: string;
}

interface AgentRole {
  userId: string;
  displayName: string;
  role: 'owner' | 'member' | 'viewer';
}

interface UpgradeRequest {
  id: string;
  userId: string;
  displayName: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface RunParams {
  page?: number;
  limit?: number;
  status?: string;
}

interface AnalyzeGoalResult {
  name: string;
  avatar: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  respondTo: string;
  memoryEnabled: boolean;
}

export function useAgents() {
  return useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents'),
  });
}

export function useAgent(id: string) {
  return useQuery<Agent>({
    queryKey: ['agents', id],
    queryFn: () => api.get(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentPayload) => api.post<Agent>('/agents', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateAgentPayload) => api.patch<Agent>(`/agents/${id}`, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['agents', variables.id] });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/agents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useAgentVersions(id: string) {
  return useQuery<AgentVersion[]>({
    queryKey: ['agents', id, 'versions'],
    queryFn: () => api.get(`/agents/${id}/versions`),
    enabled: !!id,
  });
}

export function useRevertAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post(`/agents/${id}/revert`, { version }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.id] });
      qc.invalidateQueries({ queryKey: ['agents', variables.id, 'versions'] });
    },
  });
}

export function useAgentRuns(id: string, params?: RunParams) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.status) searchParams.set('status', params.status);
  const qs = searchParams.toString();

  return useQuery<{ runs: Run[]; total: number }>({
    queryKey: ['agents', id, 'runs', params],
    queryFn: () => api.get(`/agents/${id}/runs${qs ? `?${qs}` : ''}`),
    enabled: !!id,
  });
}

export function useAgentMemories(id: string) {
  return useQuery<Memory[]>({
    queryKey: ['agents', id, 'memories'],
    queryFn: () => api.get(`/agents/${id}/memories`),
    enabled: !!id,
  });
}

export function useAddMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, fact, category }: { agentId: string; fact: string; category: string }) =>
      api.post(`/agents/${agentId}/memories`, { fact, category }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'memories'] });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, memoryId }: { agentId: string; memoryId: string }) =>
      api.del(`/agents/${agentId}/memories/${memoryId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'memories'] });
    },
  });
}

export function useClearMemories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.del(`/agents/${agentId}/memories`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: ['agents', agentId, 'memories'] });
    },
  });
}

export function useAgentRoles(id: string) {
  return useQuery<AgentRole[]>({
    queryKey: ['agents', id, 'roles'],
    queryFn: () => api.get(`/agents/${id}/roles`),
    enabled: !!id,
  });
}

export function useSetAgentRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, userId, role }: { agentId: string; userId: string; role: string }) =>
      api.put(`/agents/${agentId}/roles/${userId}`, { role }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'roles'] });
    },
  });
}

export function useRemoveAgentRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, userId }: { agentId: string; userId: string }) =>
      api.del(`/agents/${agentId}/roles/${userId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'roles'] });
    },
  });
}

export function useUpdateAgentAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, defaultAccess, writePolicy }: { agentId: string; defaultAccess?: string; writePolicy?: string }) =>
      api.patch(`/agents/${agentId}/access`, { default_access: defaultAccess, write_policy: writePolicy }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId] });
    },
  });
}

export function useUpgradeRequests(id: string) {
  return useQuery<UpgradeRequest[]>({
    queryKey: ['agents', id, 'upgrade-requests'],
    queryFn: () => api.get(`/agents/${id}/upgrade-requests`),
    enabled: !!id,
  });
}

export function useApproveUpgrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, requestId }: { agentId: string; requestId: string }) =>
      api.post(`/agents/${agentId}/upgrade-requests/${requestId}/approve`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'upgrade-requests'] });
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'roles'] });
    },
  });
}

export function useDenyUpgrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, requestId }: { agentId: string; requestId: string }) =>
      api.post(`/agents/${agentId}/upgrade-requests/${requestId}/deny`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'upgrade-requests'] });
    },
  });
}

export function useAgentTools(id: string) {
  return useQuery<string[]>({
    queryKey: ['agents', id, 'tools'],
    queryFn: () => api.get(`/agents/${id}/tools`),
    enabled: !!id,
  });
}

export function useAddAgentTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, tool }: { agentId: string; tool: string }) =>
      api.post(`/agents/${agentId}/tools`, { tool }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'tools'] });
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId] });
    },
  });
}

export function useRemoveAgentTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, tool }: { agentId: string; tool: string }) =>
      api.del(`/agents/${agentId}/tools/${tool}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'tools'] });
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId] });
    },
  });
}

export function useAgentSkills(id: string) {
  return useQuery<{ id: string; name: string; skillType: string }[]>({
    queryKey: ['agents', id, 'skills'],
    queryFn: () => api.get(`/agents/${id}/skills`),
    enabled: !!id,
  });
}

export function useAttachSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.post(`/agents/${agentId}/skills`, { skillId }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'skills'] });
    },
  });
}

export function useDetachSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.del(`/agents/${agentId}/skills/${skillId}`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'skills'] });
    },
  });
}

export function useAnalyzeGoal() {
  return useMutation({
    mutationFn: (goal: string) => api.post<AnalyzeGoalResult>('/agents/analyze-goal', { goal }),
  });
}
