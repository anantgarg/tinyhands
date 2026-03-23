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
  configKeys: { key: string; label: string; placeholder: string; required: boolean; secret: boolean }[];
  setupGuide: string | null;
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

// ── Custom Tool Builder ──

export interface GeneratedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  language: string;
}

export interface SandboxTestResult {
  passed: boolean;
  output: string;
  error: string | null;
  durationMs: number;
}

export interface ToolVersion {
  version: number;
  changedBy: string;
  createdAt: string;
}

export interface ToolAnalytics {
  toolName: string;
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: string | null;
  lastError: string | null;
}

export function useGenerateTool() {
  return useMutation({
    mutationFn: ({ description, language }: { description: string; language?: string }) =>
      api.post<GeneratedTool>('/tools/custom/generate', { description, language }),
  });
}

export function useTestTool() {
  return useMutation({
    mutationFn: ({ name, code, inputSchema }: { name: string; code?: string; inputSchema?: Record<string, unknown> }) =>
      api.post<SandboxTestResult>(`/tools/custom/${name}/test`, { code, inputSchema }),
  });
}

export function useToolVersions(name: string) {
  return useQuery<ToolVersion[]>({
    queryKey: ['tools', 'custom', name, 'versions'],
    queryFn: () => api.get(`/tools/custom/${name}/versions`),
    enabled: !!name,
  });
}

export function useRollbackTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, version }: { name: string; version: number }) =>
      api.post(`/tools/custom/${name}/rollback`, { version }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['tools', 'custom'] });
      qc.invalidateQueries({ queryKey: ['tools', 'custom', variables.name, 'versions'] });
    },
  });
}

export function useToolAnalytics(name: string) {
  return useQuery<ToolAnalytics>({
    queryKey: ['tools', 'custom', name, 'analytics'],
    queryFn: () => api.get(`/tools/custom/${name}/analytics`),
    enabled: !!name,
  });
}
