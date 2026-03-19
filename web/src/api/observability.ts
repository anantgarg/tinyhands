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
