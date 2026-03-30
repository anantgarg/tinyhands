import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface Connection {
  id: string;
  integrationId: string;
  integrationName: string;
  displayName: string;
  type: 'team' | 'personal';
  userId: string | null;
  userDisplayName: string | null;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  rootFolderId?: string | null;
  rootFolderName?: string | null;
}

interface OAuthIntegration {
  id: string;
  name: string;
  displayName: string;
  description: string;
  oauthSupported: boolean;
}

interface AgentToolMode {
  agentId: string;
  agentName: string;
  toolName: string;
  mode: 'team' | 'personal' | 'hybrid';
}

interface CreateConnectionPayload {
  integrationId: string;
  displayName: string;
  credentials: Record<string, string>;
}

export function useTeamConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections', 'team'],
    queryFn: () => api.get('/connections/team'),
  });
}

export function usePersonalConnections() {
  return useQuery<Connection[]>({
    queryKey: ['connections', 'personal'],
    queryFn: () => api.get('/connections/personal'),
  });
}

export function useCreateTeamConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateConnectionPayload) => api.post('/connections/team', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });
}

export function useCreatePersonalConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateConnectionPayload) => api.post('/connections/personal', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });
}

export function useUpdateConnectionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rootFolderId, rootFolderName }: { id: string; rootFolderId: string; rootFolderName: string }) =>
      api.patch(`/connections/${id}/settings`, { rootFolderId, rootFolderName }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });
}

export function useOAuthIntegrations() {
  return useQuery<OAuthIntegration[]>({
    queryKey: ['connections', 'oauth-integrations'],
    queryFn: () => api.get('/connections/oauth-integrations'),
  });
}

export function useOAuthUrl(integration: string) {
  return useQuery<{ url: string }>({
    queryKey: ['connections', 'oauth-url', integration],
    queryFn: () => api.get(`/connections/oauth/${integration}/url`),
    enabled: !!integration,
  });
}

export function useAgentToolModes() {
  return useQuery<AgentToolMode[]>({
    queryKey: ['connections', 'agent-tool-modes'],
    queryFn: () => api.get('/connections/agent-tool-modes'),
  });
}

export function useSetAgentToolMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, toolName, mode }: { agentId: string; toolName: string; mode: string }) =>
      api.put(`/connections/agent-tool-modes/${agentId}/${toolName}`, { mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections', 'agent-tool-modes'] }),
  });
}

export function useExpiredConnectionCount() {
  return useQuery({
    queryKey: ['connections', 'expired-count'],
    queryFn: () => api.get<{ count: number }>('/connections/expired-count'),
    refetchInterval: 60000,
  });
}

export function useAgentToolConnections(agentId: string) {
  return useQuery<AgentToolMode[]>({
    queryKey: ['connections', 'agent', agentId],
    queryFn: () => api.get(`/connections/agent/${agentId}`),
    enabled: !!agentId,
  });
}

export function useSetAgentToolConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, toolName, mode }: { agentId: string; toolName: string; mode: string }) =>
      api.put(`/connections/agent/${agentId}/${toolName}`, { mode }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['connections', 'agent', variables.agentId] });
      qc.invalidateQueries({ queryKey: ['connections', 'agent-tool-modes'] });
    },
  });
}
