import { useQuery } from '@tanstack/react-query';
import { api } from './client';

interface DashboardMetrics {
  totalRuns: number;
  totalCost: number;
  totalTokens: number;
  errorRate: number;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p50QueueWait: number;
  p95QueueWait: number;
  runsByDay: { date: string; count: number }[];
}

interface PowerUser {
  userId: string;
  displayName: string;
  runCount: number;
  totalCost: number;
}

interface AgentCreator {
  userId: string;
  displayName: string;
  agentCount: number;
}

interface PopularAgent {
  id: string;
  name: string;
  avatar: string;
  runCount: number;
  totalCost: number;
  avgDuration: number;
}

interface RecentRun {
  id: string;
  traceId: string;
  agentName: string;
  agentAvatar: string;
  userId: string;
  displayName: string;
  status: string;
  model: string;
  cost: number;
  durationMs: number;
  createdAt: string;
}

interface FleetAgent {
  id: string;
  name: string;
  avatar: string;
  status: string;
  model: string;
  toolsCount: number;
  channelsCount: number;
  lastRunAt: string | null;
  totalRuns: number;
}

interface AuditEntry {
  id: string;
  action: string;
  userId: string;
  displayName: string;
  details: string;
  createdAt: string;
}

export function useDashboardMetrics(days: number = 7) {
  return useQuery<DashboardMetrics>({
    queryKey: ['dashboard', 'metrics', days],
    queryFn: () => api.get(`/dashboard/metrics?days=${days}`),
  });
}

export function usePowerUsers(days: number = 7) {
  return useQuery<PowerUser[]>({
    queryKey: ['dashboard', 'power-users', days],
    queryFn: () => api.get(`/dashboard/power-users?days=${days}`),
  });
}

export function useAgentCreators() {
  return useQuery<AgentCreator[]>({
    queryKey: ['dashboard', 'creators'],
    queryFn: () => api.get('/dashboard/agent-creators'),
  });
}

export function usePopularAgents(days: number = 7) {
  return useQuery<PopularAgent[]>({
    queryKey: ['dashboard', 'popular-agents', days],
    queryFn: () => api.get(`/dashboard/popular-agents?days=${days}`),
  });
}

export function useRecentRuns() {
  return useQuery<RecentRun[]>({
    queryKey: ['dashboard', 'recent-runs'],
    queryFn: () => api.get('/dashboard/recent-runs'),
  });
}

export function useAgentFleet() {
  return useQuery<FleetAgent[]>({
    queryKey: ['dashboard', 'fleet'],
    queryFn: () => api.get('/dashboard/fleet'),
  });
}

export function useRecentActivity() {
  return useQuery<AuditEntry[]>({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: () => api.get('/dashboard/recent-activity'),
  });
}
