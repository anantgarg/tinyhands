import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface WorkspaceSettings {
  general: {
    workspaceName: string;
    defaultModel: string;
    dailyBudgetUsd: number;
  };
  defaults: {
    defaultAccess: string;
    writePolicy: string;
    maxTurns: number;
    memoryEnabled: boolean;
  };
  rateLimits: {
    tpmLimit: number;
    rpmLimit: number;
    concurrentRunsLimit: number;
  };
  alerts: {
    errorRateThreshold: number;
    costAlertThreshold: number;
    durationAlertThreshold: number;
  };
}

export function useSettings() {
  return useQuery<WorkspaceSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings'),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<WorkspaceSettings>) => api.patch('/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useAnthropicKeyStatus() {
  return useQuery<{ configured: boolean }>({
    queryKey: ['settings', 'anthropic-key', 'status'],
    queryFn: () => api.get('/settings/anthropic-key/status'),
  });
}

export function useTestAnthropicKey() {
  return useMutation<{ ok: boolean; reason?: string }, Error, string>({
    mutationFn: (apiKey: string) => api.post('/settings/anthropic-key/test', { apiKey }),
  });
}

export function useSaveAnthropicKey() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (apiKey: string) => api.put('/settings/anthropic-key', { apiKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'anthropic-key', 'status'] }),
  });
}

// ── Reducto (optional document parsing) ──

interface ReductoStatus { configured: boolean; enabled: boolean }

export function useReductoStatus() {
  return useQuery<ReductoStatus>({
    queryKey: ['settings', 'reducto-key', 'status'],
    queryFn: () => api.get('/settings/reducto-key/status'),
  });
}

export function useTestReductoKey() {
  return useMutation<{ ok: boolean; reason?: string }, Error, string>({
    mutationFn: (apiKey: string) => api.post('/settings/reducto-key/test', { apiKey }),
  });
}

export function useSaveReductoKey() {
  const qc = useQueryClient();
  return useMutation<ReductoStatus & { ok: true }, Error, { apiKey?: string; enabled?: boolean }>({
    mutationFn: (payload) => api.put('/settings/reducto-key', payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'reducto-key', 'status'] }),
  });
}
