import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface BuiltinTool {
  name: string;
  displayName: string;
  description: string;
  category: string;
  accessLevel: string;
}

interface Integration {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: 'active' | 'inactive';
  connectionId: string | null;
  toolsCount: number;
  connectionModel: 'team' | 'personal' | 'hybrid';
  configKeys: { key: string; label: string; required: boolean; secret: boolean }[];
}

interface IntegrationConfig {
  integrationId: string;
  config: Record<string, string>;
}

interface CustomTool {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: string;
  accessLevel: string;
  approved: boolean;
  createdBy: string;
  createdAt: string;
}

interface CreateCustomToolPayload {
  name: string;
  displayName: string;
  description: string;
  schema: Record<string, unknown>;
  code: string;
  accessLevel?: string;
}

interface AvailableTool {
  name: string;
  displayName: string;
  description: string;
  category: string;
  source: 'builtin' | 'custom' | 'integration';
  accessLevel?: string;
}

export function useBuiltinTools() {
  return useQuery<BuiltinTool[]>({
    queryKey: ['tools', 'builtin'],
    queryFn: () => api.get('/tools/builtin'),
  });
}

export function useIntegrations() {
  return useQuery<Integration[]>({
    queryKey: ['tools', 'integrations'],
    queryFn: () => api.get('/tools/integrations'),
  });
}

export function useRegisterIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { integrationId: string; config: Record<string, string> }) =>
      api.post('/tools/integrations/register', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'integrations'] }),
  });
}

export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (integrationId: string) =>
      api.del(`/tools/integrations/${integrationId}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'integrations'] }),
  });
}

export function useIntegrationConfig(id: string) {
  return useQuery<IntegrationConfig>({
    queryKey: ['tools', 'integrations', id, 'config'],
    queryFn: () => api.get(`/tools/integrations/${id}/config`),
    enabled: !!id,
  });
}

export function useUpdateIntegrationConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, string> }) =>
      api.patch(`/tools/integrations/${id}/config`, { config }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['tools', 'integrations'] });
      qc.invalidateQueries({ queryKey: ['tools', 'integrations', variables.id, 'config'] });
    },
  });
}

export function useCustomTools() {
  return useQuery<CustomTool[]>({
    queryKey: ['tools', 'custom'],
    queryFn: () => api.get('/tools/custom'),
  });
}

export function useCreateCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomToolPayload) => api.post('/tools/custom', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'custom'] }),
  });
}

export function useApproveCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/tools/custom/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'custom'] }),
  });
}

export function useDeleteCustomTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/tools/custom/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'custom'] }),
  });
}

export function useSetToolAccessLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accessLevel }: { id: string; accessLevel: string }) =>
      api.patch(`/tools/custom/${id}/access`, { accessLevel }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools', 'custom'] }),
  });
}

export function useAvailableTools() {
  return useQuery<AvailableTool[]>({
    queryKey: ['tools', 'available'],
    queryFn: () => api.get('/tools/available'),
  });
}
