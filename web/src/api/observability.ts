import { useQuery } from '@tanstack/react-query';
import { api } from './client';

interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  agentId: string | null;
  agentName: string | null;
  acknowledged: boolean;
  createdAt: string;
}

interface ErrorRate {
  agentId: string;
  agentName: string;
  totalRuns: number;
  errorCount: number;
  errorRate: number;
  period: string;
}

export interface ErrorLogEntry {
  id: string;
  agentId: string;
  agentName: string;
  avatarEmoji: string;
  traceId: string;
  slackUserId: string | null;
  displayName: string;
  status: string;
  model: string;
  input: string;
  output: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  createdAt: string;
  completedAt: string | null;
}

export function useAlerts() {
  return useQuery<Alert[]>({
    queryKey: ['observability', 'alerts'],
    queryFn: () => api.get('/observability/alerts'),
  });
}

export function useErrorRates() {
  return useQuery<ErrorRate[]>({
    queryKey: ['observability', 'error-rates'],
    queryFn: () => api.get('/observability/error-rates'),
  });
}

export function useErrorLog(params?: { days?: number; agentId?: string; limit?: number }) {
  return useQuery<ErrorLogEntry[]>({
    queryKey: ['observability', 'error-log', params],
    queryFn: () =>
      api.get(
        `/observability/error-log?days=${params?.days ?? 7}&limit=${params?.limit ?? 50}${params?.agentId ? `&agentId=${params.agentId}` : ''}`,
      ),
  });
}
