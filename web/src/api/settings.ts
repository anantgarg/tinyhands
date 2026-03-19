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
