import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// IMPORTANT: src/api/client.ts converts snake_case → camelCase on response,
// so the dashboard sees camelCase keys (lastSyncedAt, sourceConfig, ...).

export type DatabaseColumnType =
  | 'text' | 'integer' | 'bigint' | 'numeric' | 'boolean' | 'timestamptz' | 'date' | 'json';

export interface DatabaseColumn {
  name: string;
  type: DatabaseColumnType;
  nullable?: boolean;
  description?: string | null;
}

export type DatabaseSyncStatus = 'success' | 'partial_sync' | 'failed';
export type DatabaseSyncIssueKind =
  | 'unmapped_column' | 'removed_column' | 'renamed_column'
  | 'row_type_mismatch' | 'auth_failed' | 'fetch_failed';

export interface DatabaseSyncIssue {
  kind: DatabaseSyncIssueKind;
  column?: string;
  from?: string;
  to?: string;
  rowIndex?: number;
  value?: string;
  message?: string;
}

export interface DatabaseSyncLog {
  id: string;
  tableId: string;
  status: DatabaseSyncStatus;
  rowsImported: number;
  rowsSkipped: number;
  detail: { issues: DatabaseSyncIssue[] };
  createdAt: string;
}

export interface DatabaseTable {
  id: string;
  name: string;
  description: string | null;
  sourceType: 'manual' | 'csv' | 'xlsx' | 'google_sheet';
  sourceConfig: {
    spreadsheetId?: string;
    sheetName?: string;
    syncEnabled?: boolean;
    ignoredColumns?: string[];
    columnMapping?: Record<string, string>;
  };
  lastSyncedAt: string | null;
  lastSyncStatus: DatabaseSyncStatus | null;
  createdAt: string;
  updatedAt: string;
  latestSync?: DatabaseSyncLog | null;
  columns?: DatabaseColumn[];
  recentLogs?: DatabaseSyncLog[];
}

export function useDatabaseTables() {
  return useQuery<DatabaseTable[]>({
    queryKey: ['database', 'tables'],
    queryFn: () => api.get('/database/tables'),
  });
}

export function useDatabaseTable(id: string | null) {
  return useQuery<DatabaseTable>({
    queryKey: ['database', 'tables', id],
    queryFn: () => api.get(`/database/tables/${id}`),
    enabled: !!id,
  });
}

export function useCreateDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; columns: DatabaseColumn[] }) =>
      api.post('/database/tables', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useDeleteDatabaseTable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/database/tables/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useColumnOp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; op: 'add' | 'rename' | 'drop';
      column?: string; from?: string; to?: string; type?: DatabaseColumnType;
      nullable?: boolean; confirm?: boolean; description?: string;
    }) => api.patch(`/database/tables/${id}/columns`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useUpdateColumnDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, column, description }: { id: string; column: string; description: string }) =>
      api.patch(`/database/tables/${id}/columns/${encodeURIComponent(column)}/description`, { description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useSuggestColumnDescriptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ updated: number }>(`/database/tables/${id}/suggest-column-descriptions`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useUpdateTableDescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      api.patch(`/database/tables/${id}`, { description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useDatabaseRows(tableId: string | null, params?: { limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return useQuery<{ rows: any[]; total: number }>({
    queryKey: ['database', 'rows', tableId, params],
    queryFn: () => api.get(`/database/tables/${tableId}/rows${suffix}`),
    enabled: !!tableId,
  });
}

export function useInsertRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, any> }) =>
      api.post(`/database/tables/${id}/rows`, { values }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['database', 'rows', v.id] }),
  });
}

export function useUpdateRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rowId, values }: { id: string; rowId: number; values: Record<string, any> }) =>
      api.patch(`/database/tables/${id}/rows/${rowId}`, { values }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['database', 'rows', v.id] }),
  });
}

export function useDeleteRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rowId }: { id: string; rowId: number }) =>
      api.del(`/database/tables/${id}/rows/${rowId}`),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['database', 'rows', v.id] }),
  });
}

export function useImportDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      kind: 'csv' | 'xlsx' | 'google_sheet';
      name: string;
      description?: string;
      columnDescriptions?: Record<string, string>;
      csvText?: string;
      xlsxBase64?: string;
      sheetName?: string;
      spreadsheetId?: string;
      syncEnabled?: boolean;
    }) => api.post('/database/import', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useSyncSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/database/tables/${id}/sync`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export function useIgnoreColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, column }: { id: string; column: string }) =>
      api.post(`/database/tables/${id}/sync/ignore-column`, { column }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}

export interface DriveSheetEntry { id: string; name: string; modifiedTime?: string }

export interface SheetTab { title: string; rowCount?: number; colCount?: number }

export function useSheetTabs(spreadsheetId: string | null) {
  return useQuery<{ tabs: SheetTab[] }>({
    queryKey: ['database', 'sheet-tabs', spreadsheetId],
    queryFn: () => api.get(`/database/sheet-tabs?spreadsheetId=${encodeURIComponent(spreadsheetId || '')}`),
    enabled: !!spreadsheetId,
  });
}

export function useDriveSheets(parentId: string | null) {
  return useQuery<{
    parentId: string;
    folders: DriveSheetEntry[];
    sheets: DriveSheetEntry[];
    restrictedRootId: string | null;
    restrictedRootName: string | null;
  }>({
    queryKey: ['database', 'drive-sheets', parentId],
    queryFn: () => api.get(`/database/drive-sheets?parentId=${encodeURIComponent(parentId || 'root')}`),
    enabled: parentId !== null,
  });
}

export function useMapColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, from, to }: { id: string; from: string; to: string }) =>
      api.post(`/database/tables/${id}/sync/map-column`, { from, to }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['database'] }),
  });
}
