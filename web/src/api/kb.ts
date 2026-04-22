import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface KBEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  approved: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  kbSourceId: string | null;
  sourceName: string | null;
  sourceType: string | null;
}

interface KBEntryParams {
  page?: number;
  limit?: number;
  category?: string;
  approved?: boolean;
  search?: string;
  sourceId?: string;
}

interface KBStats {
  totalEntries: number;
  pendingEntries: number;
  categories: number;
  sourcesCount: number;
  manualEntries: number;
}

interface KBSource {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  status: string;
  autoSync?: boolean;
  auto_sync?: boolean;
  syncIntervalHours?: number;
  sync_interval_hours?: number;
  lastSyncAt: string | null;
  entriesCount: number;
  errorMessage?: string | null;
  // Structured hint for the dashboard. `reconnect` → the viewer owns the
  // broken connection, render a Reconnect button. `ask_owner` → another
  // admin owns it; render a non-interactive "Ask <Name>" chip instead.
  errorFix?:
    | { kind: 'reconnect'; integration: string }
    | { kind: 'ask_owner'; integration: string; ownerName: string | null }
    | null;
  skippedCount?: number;
  createdAt: string;
}

export interface KBSourceSkipLogEntry {
  id: string;
  filename: string;
  filePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  reason: string;
  reasonLabel: string;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

interface KBApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
}

interface CreateKBEntryPayload {
  title: string;
  content: string;
  category?: string;
}

interface CreateKBSourcePayload {
  name: string;
  sourceType: string;
  config: Record<string, unknown>;
}

export function useKBEntries(params?: KBEntryParams) {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.category) searchParams.set('category', params.category);
  if (params?.approved !== undefined) searchParams.set('approved', String(params.approved));
  if (params?.search) searchParams.set('search', params.search);
  if (params?.sourceId) searchParams.set('sourceId', params.sourceId);
  const qs = searchParams.toString();

  return useQuery<{ entries: KBEntry[]; total: number }>({
    queryKey: ['kb', 'entries', params],
    queryFn: () => api.get(`/kb/entries${qs ? `?${qs}` : ''}`),
  });
}

export function useKBEntry(id: string) {
  return useQuery<KBEntry>({
    queryKey: ['kb', 'entries', id],
    queryFn: () => api.get(`/kb/entries/${id}`),
    enabled: !!id,
  });
}

export function useCreateKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateKBEntryPayload) => api.post('/kb/entries', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

export function useApproveKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/kb/entries/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] });
      qc.invalidateQueries({ queryKey: ['pending-counts'] });
    },
  });
}

export function useDeleteKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/kb/entries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb'] });
      qc.invalidateQueries({ queryKey: ['pending-counts'] });
    },
  });
}

export function useUpdateKBEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; content?: string; category?: string }) =>
      api.patch(`/kb/entries/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

export function useKBCategories() {
  return useQuery<string[]>({
    queryKey: ['kb', 'categories'],
    queryFn: () => api.get('/kb/categories'),
  });
}

export function useKBSearch(q: string) {
  return useQuery<KBEntry[]>({
    queryKey: ['kb', 'search', q],
    queryFn: () => api.get(`/kb/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
}

export function useKBStats() {
  return useQuery<KBStats>({
    queryKey: ['kb', 'stats'],
    queryFn: () => api.get('/kb/stats'),
  });
}

export function useKBSources() {
  return useQuery<KBSource[]>({
    queryKey: ['kb', 'sources'],
    queryFn: () => api.get('/kb/sources'),
  });
}

export function useCreateKBSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateKBSourcePayload) => api.post('/kb/sources', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'sources'] }),
  });
}

export function useUpdateKBSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; config?: Record<string, unknown>; autoSync?: boolean; syncIntervalHours?: number }) =>
      api.patch(`/kb/sources/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'sources'] }),
  });
}

export function useDriveFolderName(folderId: string | null) {
  return useQuery<{ id: string; name: string }>({
    queryKey: ['kb', 'drive-folder-name', folderId],
    queryFn: () => api.get(`/kb/drive-folder-name/${folderId}`),
    enabled: !!folderId,
    staleTime: 60_000,
  });
}

export function useSyncKBSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/kb/sources/${id}/sync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'sources'] }),
  });
}

export function useDeleteKBSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/kb/sources/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'sources'] }),
  });
}

export function useKBSourceSkipLog(id: string | null) {
  return useQuery<KBSourceSkipLogEntry[]>({
    queryKey: ['kb', 'sources', id, 'skip-log'],
    queryFn: () => api.get(`/kb/sources/${id}/skip-log`),
    enabled: !!id,
  });
}

export function useReparseKBSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/kb/sources/${id}/reparse`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'sources'] }),
  });
}

export function useKBApiKeys() {
  return useQuery<KBApiKey[]>({
    queryKey: ['kb', 'api-keys'],
    queryFn: () => api.get('/kb/api-keys'),
  });
}

export function useSetKBApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) => api.post<{ key: string }>('/kb/api-keys', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'api-keys'] }),
  });
}

export function useDeleteKBApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/kb/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'api-keys'] }),
  });
}

interface DriveFolder {
  id: string;
  name: string;
}

export function useDriveFolders(parentId: string | null) {
  return useQuery<{ parentId: string; folders: DriveFolder[] }>({
    queryKey: ['kb', 'drive-folders', parentId],
    queryFn: () => api.get(`/kb/drive-folders?parentId=${encodeURIComponent(parentId || 'root')}`),
    enabled: parentId !== null,
  });
}
