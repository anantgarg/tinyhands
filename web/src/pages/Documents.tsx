import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useDocuments, useDocStats, useCreateDocument, useArchiveDocument, useDeleteDocument,
  useUploadFile, useImportCsv, useImportDocx,
  type DocType,
} from '@/api/docs';
import { useAgents } from '@/api/agents';
import { useAuthStore } from '@/store/auth';
import {
  FileText, Table2, FileUp, Plus, Search, MoreHorizontal,
  Trash2, Archive, Download, ChevronLeft, ChevronRight,
  File, Upload,
} from 'lucide-react';

const TYPE_ICONS: Record<string, typeof FileText> = {
  doc: FileText,
  sheet: Table2,
  file: File,
};

const TYPE_LABELS: Record<string, string> = {
  doc: 'Document',
  sheet: 'Spreadsheet',
  file: 'File',
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function Documents() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<DocType>('doc');
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createAgentId, setCreateAgentId] = useState('');
  const { data: agents } = useAgents();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);

  const params = {
    type: typeFilter !== 'all' ? (typeFilter as DocType) : undefined,
    search: search || undefined,
    page,
    limit: 20,
  };

  const { data, isLoading } = useDocuments(params);
  const { data: stats } = useDocStats();
  const createDoc = useCreateDocument();
  const archiveDoc = useArchiveDocument();
  const deleteDoc = useDeleteDocument();
  const uploadFileMutation = useUploadFile();
  const importCsvMutation = useImportCsv();
  const importDocxMutation = useImportDocx();

  const totalPages = Math.ceil((data?.total || 0) / 20);

  const handleCreate = useCallback(async () => {
    if (!createTitle.trim() || !createAgentId) return;
    await createDoc.mutateAsync({
      type: createType,
      title: createTitle.trim(),
      description: createDesc.trim() || undefined,
      agentId: createAgentId,
    });
    setCreateOpen(false);
    setCreateTitle('');
    setCreateDesc('');
    setCreateAgentId('');
  }, [createDoc, createType, createTitle, createDesc, createAgentId]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('File must be under 25 MB'); e.target.value = ''; return; }
    await uploadFileMutation.mutateAsync({ file });
    e.target.value = '';
  }, [uploadFileMutation]);

  const handleCsvImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('CSV file must be under 10 MB'); e.target.value = ''; return; }
    await importCsvMutation.mutateAsync({ file });
    e.target.value = '';
  }, [importCsvMutation]);

  const handleDocxImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('DOCX file must be under 25 MB'); e.target.value = ''; return; }
    await importDocxMutation.mutateAsync({ file });
    e.target.value = '';
  }, [importDocxMutation]);

  return (
    <div>
      <PageHeader title="Documents" description="Manage documents, spreadsheets, and files">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> New</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setCreateType('doc'); setCreateOpen(true); }}>
              <FileText className="mr-2 h-4 w-4" /> New Document
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setCreateType('sheet'); setCreateOpen(true); }}>
              <Table2 className="mr-2 h-4 w-4" /> New Spreadsheet
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" /> Upload File
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => csvInputRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> Import CSV as Sheet
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => docxInputRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> Import DOCX as Document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
        <input ref={csvInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
        <input ref={docxInputRef} type="file" accept=".docx" className="hidden" onChange={handleDocxImport} />
      </PageHeader>

      {/* Stats */}
      {stats && (
        <div className="mb-6 flex gap-4 text-sm text-warm-text-secondary">
          <span>{stats.totalDocs} documents</span>
          <span>{stats.totalSheets} spreadsheets</span>
          <span>{stats.totalFiles} files</span>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <Tabs value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="doc">Docs</TabsTrigger>
            <TabsTrigger value="sheet">Sheets</TabsTrigger>
            <TabsTrigger value="file">Files</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-text-secondary" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-warm-border bg-warm-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead className="w-[100px]">Type</TableHead>
              <TableHead className="w-[140px]">Agent</TableHead>
              <TableHead className="w-[100px]">Size</TableHead>
              <TableHead className="w-[120px]">Updated</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-warm-text-secondary">Loading...</TableCell>
              </TableRow>
            ) : data?.documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-warm-text-secondary">
                  No documents found. Create one to get started.
                </TableCell>
              </TableRow>
            ) : data?.documents.map((doc) => {
              const Icon = TYPE_ICONS[doc.type] || File;
              return (
                <TableRow
                  key={doc.id}
                  className="cursor-pointer hover:bg-warm-surface-hover"
                  onClick={() => navigate(`/documents/${doc.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-warm-text-secondary shrink-0" />
                      <span className="truncate">{doc.title}</span>
                      {!doc.agentEditable && (
                        <Badge variant="secondary" className="text-xs shrink-0">Read-only</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {TYPE_LABELS[doc.type] || doc.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm truncate">
                    {(doc as any).agentName || (doc.agentId ? 'Agent' : '—')}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {doc.type === 'file' ? formatFileSize(doc.fileSize) : ''}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {formatDate(doc.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        {doc.type === 'file' && (
                          <DropdownMenuItem
                            onClick={() => window.open(`/api/v1/docs/${doc.id}/download`, '_blank')}
                          >
                            <Download className="mr-2 h-4 w-4" /> Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => archiveDoc.mutate(doc.id)}
                          className="text-red-600"
                        >
                          <Archive className="mr-2 h-4 w-4" /> Archive
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            onClick={async () => {
                              if (confirm('Permanently delete this document?')) {
                                await deleteDoc.mutateAsync(doc.id);
                              }
                            }}
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-warm-text-secondary">
            Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, data?.total || 0)} of {data?.total || 0}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              New {createType === 'doc' ? 'Document' : 'Spreadsheet'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Agent</Label>
              <Select value={createAgentId} onValueChange={setCreateAgentId}>
                <SelectTrigger className={!createAgentId ? 'text-warm-text-secondary' : ''}>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder={createType === 'doc' ? 'Untitled Document' : 'Untitled Spreadsheet'}
                autoFocus
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Textarea
                value={createDesc}
                onChange={(e) => setCreateDesc(e.target.value)}
                placeholder="Brief description..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createTitle.trim() || !createAgentId || createDoc.isPending}>
              {createDoc.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
