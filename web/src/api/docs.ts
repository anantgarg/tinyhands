import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ── Types ──

export type DocType = 'doc' | 'sheet' | 'file';

export interface Document {
  id: string;
  workspaceId: string;
  type: DocType;
  title: string;
  description: string | null;
  content: Record<string, unknown> | null;
  mimeType: string | null;
  fileSize: number | null;
  tags: string[];
  agentId: string | null;
  agentName?: string;
  runId: string | null;
  createdBy: string;
  createdByType: 'user' | 'agent';
  updatedBy: string | null;
  agentEditable: boolean;
  version: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  version: number;
  content: Record<string, unknown>;
  changedBy: string;
  changeSummary: string | null;
  createdAt: string;
}

export interface SheetTab {
  id: string;
  documentId: string;
  name: string;
  position: number;
  columns: { id: string; name: string; type: string; width?: number }[];
  data: Record<string, { v: string | number | boolean | null; f?: string }>;
  metadata: Record<string, unknown>;
  rowCount: number;
  colCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocStats {
  totalDocs: number;
  totalSheets: number;
  totalFiles: number;
  totalArchived: number;
}

interface ListDocsParams {
  type?: DocType;
  agentId?: string;
  createdBy?: string;
  tags?: string;
  search?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
}

// ── Hooks ──

export function useDocuments(params?: ListDocsParams) {
  const sp = new URLSearchParams();
  if (params?.type) sp.set('type', params.type);
  if (params?.agentId) sp.set('agentId', params.agentId);
  if (params?.createdBy) sp.set('createdBy', params.createdBy);
  if (params?.tags) sp.set('tags', params.tags);
  if (params?.search) sp.set('search', params.search);
  if (params?.includeArchived) sp.set('includeArchived', 'true');
  if (params?.page) sp.set('page', String(params.page));
  if (params?.limit) sp.set('limit', String(params.limit));
  const qs = sp.toString();

  return useQuery<{ documents: Document[]; total: number }>({
    queryKey: ['docs', 'list', params],
    queryFn: () => api.get(`/docs${qs ? `?${qs}` : ''}`),
  });
}

export function useDocument(id: string) {
  return useQuery<Document & { tabs?: SheetTab[] }>({
    queryKey: ['docs', 'detail', id],
    queryFn: () => api.get(`/docs/${id}`),
    enabled: !!id,
  });
}

export function useDocStats() {
  return useQuery<DocStats>({
    queryKey: ['docs', 'stats'],
    queryFn: () => api.get('/docs/stats'),
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: DocType; title: string; description?: string; content?: any; tags?: string[] }) =>
      api.post('/docs', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; description?: string; content?: any; tags?: string[]; agentEditable?: boolean; expectedVersion: number }) =>
      api.patch(`/docs/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useArchiveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/docs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/docs/${id}/permanent`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { file: File; tags?: string[] }) => {
      const formData = new FormData();
      formData.append('file', data.file);
      if (data.tags) formData.append('tags', JSON.stringify(data.tags));
      return fetch('/api/v1/docs/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
        return res.json();
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { file: File; title?: string }) => {
      const formData = new FormData();
      formData.append('file', data.file);
      if (data.title) formData.append('title', data.title);
      return fetch('/api/v1/docs/import-csv', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Import failed');
        return res.json();
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useImportDocx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { file: File; title?: string }) => {
      const formData = new FormData();
      formData.append('file', data.file);
      if (data.title) formData.append('title', data.title);
      return fetch('/api/v1/docs/import-docx', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Import failed');
        return res.json();
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useReplaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { docId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', data.file);
      return fetch(`/api/v1/docs/${data.docId}/replace`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }).then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || 'Replace failed');
        return res.json();
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useDocVersions(docId: string) {
  return useQuery<DocumentVersion[]>({
    queryKey: ['docs', 'versions', docId],
    queryFn: () => api.get(`/docs/${docId}/versions`),
    enabled: !!docId,
  });
}

export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, version }: { docId: string; version: number }) =>
      api.post(`/docs/${docId}/versions/${version}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useSheetTabs(docId: string) {
  return useQuery<SheetTab[]>({
    queryKey: ['docs', 'tabs', docId],
    queryFn: () => api.get(`/docs/${docId}/tabs`),
    enabled: !!docId,
  });
}

export function useCreateSheetTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, name }: { docId: string; name: string }) =>
      api.post(`/docs/${docId}/tabs`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useUpdateSheetTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, tabId, ...data }: { docId: string; tabId: string; name?: string; data?: any; metadata?: any }) =>
      api.patch(`/docs/${docId}/tabs/${tabId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useDeleteSheetTab() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, tabId }: { docId: string; tabId: string }) =>
      api.del(`/docs/${docId}/tabs/${tabId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}

export function useUpdateCells() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, tabId, cells }: { docId: string; tabId: string; cells: Record<string, any> }) =>
      api.patch(`/docs/${docId}/tabs/${tabId}/cells`, { cells }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs'] }),
  });
}
