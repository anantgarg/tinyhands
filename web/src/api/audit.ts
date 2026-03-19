import { useQuery } from '@tanstack/react-query';
import { api } from './client';

interface AuditEntry {
  id: string;
  action: string;
  userId: string;
  displayName: string;
  targetType: string;
  targetId: string;
  targetName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface AuditParams {
  page?: number;
  limit?: number;
  action?: string;
  userId?: string;
  search?: string;
}

export function useAuditLog(params?: AuditParams) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.action) searchParams.set('action', params.action);
  if (params?.userId) searchParams.set('userId', params.userId);
  if (params?.search) searchParams.set('search', params.search);
  const qs = searchParams.toString();

  return useQuery<{ entries: AuditEntry[]; total: number }>({
    queryKey: ['audit', params],
    queryFn: () => api.get(`/audit${qs ? `?${qs}` : ''}`),
  });
}
