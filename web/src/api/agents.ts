import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function toSnakeKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}

export interface Agent {
  id: string;
  name: string;
  avatarEmoji: string;
  systemPrompt: string;
  status: string;
  model: string;
  tools: string[];
  channelId: string;
  channelIds: string[];
  maxTurns: number;
  memoryEnabled: boolean;
  respondToAllMessages: boolean;
  mentionsOnly: boolean;
  selfEvolutionMode: string;
  defaultAccess: string;
  writePolicy: string;
  relevanceKeywords: string[];
  streamingDetail: boolean;
  visibility: string;
  createdBy: string;
  createdByDisplayName?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateAgentPayload {
  name: string;
  avatarEmoji?: string;
  systemPrompt: string;
  model?: string;
  tools?: string[];
  channelIds?: string[];
  memoryEnabled?: boolean;
  maxTurns?: number;
  mentionsOnly?: boolean;
  respondToAllMessages?: boolean;
  relevanceKeywords?: string[];
  selfEvolutionMode?: string;
  defaultAccess?: string;
  writePolicy?: string;
  streamingDetail?: boolean;
}

interface UpdateAgentPayload extends Partial<CreateAgentPayload> {
  id: string;
  status?: string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  systemPrompt: string;
  changeNote: string;
  changedBy: string;
  createdAt: string;
}

export interface Run {
  id: string;
  agentId: string;
  traceId: string;
  slackUserId: string;
  displayName?: string;
  status: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  queueWaitMs: number;
  output?: string;
  createdAt: string;
}

export interface Memory {
  id: string;
  agentId: string;
  fact: string;
  category: string;
  relevanceScore: number;
  source: 'agent' | 'user';
  createdAt: string;
}

export interface AgentRole {
  agentId: string;
  userId: string;
  role: 'owner' | 'member' | 'viewer';
  grantedBy: string;
  grantedByName?: string;
  grantedAt: string;
  workspaceId: string;
  displayName?: string;
}

export interface UpgradeRequest {
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

export interface AnalyzeGoalResult {
  name: string;
  avatarEmoji: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  mentionsOnly: boolean;
  memoryEnabled: boolean;
  changes?: Record<string, { from: unknown; to: unknown }>;
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
    mutationFn: (data: CreateAgentPayload) => api.post<Agent>('/agents', toSnakeKeys(data as unknown as Record<string, unknown>)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateAgentPayload) => api.patch<Agent>(`/agents/${id}`, toSnakeKeys(data as Record<string, unknown>)),
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
      api.post(`/agents/${agentId}/roles`, { targetUserId: userId, role }),
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
      api.patch(`/agents/${agentId}/access`, { defaultAccess, writePolicy }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId] });
    },
  });
}

export function useUpgradeRequests(agentId?: string) {
  const path = agentId ? `/agents/${agentId}/upgrade-requests` : '/upgrade-requests';
  return useQuery<UpgradeRequest[]>({
    queryKey: agentId ? ['agents', agentId, 'upgrade-requests'] : ['upgrade-requests'],
    queryFn: () => api.get(path),
    enabled: agentId ? !!agentId : true,
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
      qc.invalidateQueries({ queryKey: ['upgrade-requests'] });
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
      qc.invalidateQueries({ queryKey: ['upgrade-requests'] });
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

export function useAgentTriggers(agentId: string) {
  return useQuery<Array<{
    id: string;
    agentId: string;
    type: 'slack_channel' | 'linear' | 'zendesk' | 'intercom' | 'webhook' | 'schedule';
    config: Record<string, unknown>;
    enabled: boolean;
    lastTriggeredAt: string | null;
    createdAt: string;
  }>>({
    queryKey: ['agents', agentId, 'triggers'],
    queryFn: () => api.get(`/agents/${agentId}/triggers`),
    enabled: !!agentId,
  });
}

export function useAddAgentTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, type, config }: { agentId: string; type: string; config: Record<string, unknown> }) =>
      api.post(`/agents/${agentId}/triggers`, { type, config }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'triggers'] });
      qc.invalidateQueries({ queryKey: ['triggers'] });
    },
  });
}

// ── Tool Requests ──

export interface ToolRequest {
  id: string;
  workspaceId: string;
  agentId: string;
  agentName?: string;
  toolName: string;
  accessLevel: string;
  reason: string | null;
  status: string;
  requestedBy: string;
  requestedByName?: string;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function useToolRequests(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery<ToolRequest[]>({
    queryKey: ['tool-requests', status],
    queryFn: () => api.get(`/agents/tool-requests${qs}`),
  });
}

export function useAgentToolRequests(agentId: string) {
  return useQuery<ToolRequest[]>({
    queryKey: ['agents', agentId, 'tool-requests'],
    queryFn: () => api.get(`/agents/${agentId}/tool-requests`),
    enabled: !!agentId,
  });
}

export function useCreateToolRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, toolName, accessLevel, reason }: {
      agentId: string; toolName: string; accessLevel: string; reason?: string;
    }) => api.post(`/agents/${agentId}/tool-requests`, { toolName, accessLevel, reason }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'tool-requests'] });
      qc.invalidateQueries({ queryKey: ['tool-requests'] });
    },
  });
}

export function useApproveToolRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, requestId }: { agentId: string; requestId: string }) =>
      api.post(`/agents/${agentId}/tool-requests/${requestId}/approve`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'tool-requests'] });
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId] });
      qc.invalidateQueries({ queryKey: ['tool-requests'] });
    },
  });
}

export function useDenyToolRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, requestId }: { agentId: string; requestId: string }) =>
      api.post(`/agents/${agentId}/tool-requests/${requestId}/deny`),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['agents', variables.agentId, 'tool-requests'] });
      qc.invalidateQueries({ queryKey: ['tool-requests'] });
    },
  });
}
