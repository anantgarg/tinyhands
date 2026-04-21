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
  createdAt: string;
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

// ── Wiki (plan-016) ────────────────────────────────────────────────────

export type WikiNamespace = 'kb' | 'docs';

export interface WikiPage {
  id: string;
  namespace: WikiNamespace;
  path: string;
  kind: string;
  title: string;
  content: string;
  archived_at: string | null;
  updated_at: string;
}

export interface IngestJob {
  id: string;
  workspace_id: string;
  namespace: WikiNamespace;
  source_kind: string;
  source_id: string;
  status: string;
  parser: string | null;
  pages_touched: string[];
  error: string | null;
  retries: number;
  created_at: string;
  updated_at: string;
}

export function useWikiPages(namespace: WikiNamespace, includeArchived: boolean = false) {
  return useQuery<{ namespace: WikiNamespace; pages: WikiPage[] }>({
    queryKey: ['kb', 'wiki-pages', namespace, includeArchived],
    queryFn: () => api.get(`/kb/wiki/pages?namespace=${namespace}${includeArchived ? '&includeArchived=true' : ''}`),
  });
}

export function useWikiPage(namespace: WikiNamespace, path: string | null) {
  return useQuery<WikiPage>({
    queryKey: ['kb', 'wiki-page', namespace, path],
    queryFn: () => api.get(`/kb/wiki/page?namespace=${namespace}&path=${encodeURIComponent(path || '')}`),
    enabled: !!path,
  });
}

export function useUpdateWikiSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { namespace: WikiNamespace; content: string }) =>
      api.put('/kb/wiki/schema', data),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['kb', 'wiki-pages', vars.namespace] }),
  });
}

export function useWikiMode() {
  return useQuery<{ kb: string; docs: string }>({
    queryKey: ['kb', 'wiki-mode'],
    queryFn: () => api.get('/kb/wiki/mode'),
  });
}

export function useSetWikiMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { namespace: WikiNamespace; mode: 'wiki' | 'search' | 'both' }) =>
      api.put('/kb/wiki/mode', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'wiki-mode'] }),
  });
}

export function useIngestJobs(namespace?: WikiNamespace, status?: string, documentId?: string) {
  const qs = new URLSearchParams();
  if (namespace) qs.set('namespace', namespace);
  if (status) qs.set('status', status);
  if (documentId) qs.set('documentId', documentId);
  return useQuery<{ jobs: IngestJob[] }>({
    queryKey: ['kb', 'ingest-jobs', namespace, status, documentId],
    queryFn: () => api.get(`/kb/ingest-jobs?${qs.toString()}`),
    refetchInterval: 5_000,
  });
}

export function useRetryIngestJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/kb/ingest-jobs/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'ingest-jobs'] }),
  });
}

export function useParserKeys() {
  return useQuery<{ reducto: boolean; llamaparse: boolean }>({
    queryKey: ['kb', 'parser-keys'],
    queryFn: () => api.get('/kb/parser-keys'),
  });
}

export function useSetParserKeys() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { reductoApiKey?: string; llamaParseApiKey?: string }) =>
      api.put('/kb/parser-keys', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'parser-keys'] }),
  });
}

export interface BackfillJob {
  id: string;
  namespace: WikiNamespace;
  status: string;
  total: number;
  enqueued: number;
  completed: number;
  failed: number;
  rate_per_minute: number;
  estimated_cost_usd: number | null;
}

export function useBackfills() {
  return useQuery<{ backfills: BackfillJob[] }>({
    queryKey: ['kb', 'backfills'],
    queryFn: () => api.get('/kb/wiki/backfills'),
    refetchInterval: 5_000,
  });
}

export function useStartBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { namespace: WikiNamespace; ratePerMinute?: number }) =>
      api.post('/kb/wiki/migrate', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'backfills'] }),
  });
}

export function useControlBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'cancel' }) =>
      api.post(`/kb/wiki/backfills/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb', 'backfills'] }),
  });
}
