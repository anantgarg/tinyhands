import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Plus, Search, Check, Trash2, MoreVertical, Eye, Database, AlertCircle, ArrowLeft, FileText, FolderOpen } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useKBEntries,
  useKBStats,
  useKBCategories,
  useCreateKBEntry,
  useApproveKBEntry,
  useDeleteKBEntry,
  useUpdateKBEntry,
  useKBSources,
} from '@/api/kb';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

function titleCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getSourceTypeName(type: string | null): string {
  const names: Record<string, string> = { github: 'GitHub', google_drive: 'Google Drive', zendesk: 'Zendesk', web_crawl: 'Website', notion: 'Notion' };
  return type ? names[type] ?? titleCase(type) : 'Unknown';
}

export function KnowledgeBase() {
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [tab, setTab] = useState('approved');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTags, setNewTags] = useState('');
  const [detailEntry, setDetailEntry] = useState<{
    id: string;
    title: string;
    content: string;
    category: string;
    createdBy: string;
    updatedAt: string;
    kbSourceId: string | null;
    sourceName: string | null;
  } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const approved = tab === 'approved';
  const { data: stats, isLoading: statsLoading, isError: statsError } = useKBStats();
  const { data: categories } = useKBCategories();
  const { data: sources } = useKBSources();
  const { data, isLoading, isError } = useKBEntries({
    page,
    limit: 20,
    category: category !== 'all' ? category : undefined,
    sourceId: activeSource === 'manual' ? 'manual' : activeSource || undefined,
    approved,
    search: search || undefined,
  });

  const createEntry = useCreateKBEntry();
  const approveEntry = useApproveKBEntry();
  const deleteEntry = useDeleteKBEntry();
  const updateEntry = useUpdateKBEntry();

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleCreate = () => {
    if (!newTitle.trim() || !newContent.trim()) {
      toast({ title: 'Title and content are required', variant: 'error' });
      return;
    }
    createEntry.mutate(
      {
        title: newTitle,
        content: newContent,
        category: newCategory || undefined,
      },
      {
        onSuccess: () => {
          toast({ title: 'Entry created', variant: 'success' });
          setShowAdd(false);
          setNewTitle('');
          setNewContent('');
          setNewCategory('');
          setNewTags('');
        },
      },
    );
  };

  const activeSourceName = activeSource === 'manual'
    ? 'Manual Entries'
    : (sources ?? []).find((s) => s.id === activeSource)?.name ?? 'Source';

  // Count manual entries = total - sum of source entries
  const sourceEntrySum = (sources ?? []).reduce((sum, s) => sum + (s.entriesCount ?? 0), 0);
  const manualCount = Math.max(0, (stats?.totalEntries ?? 0) - sourceEntrySum);

  return (
    <div>
      <PageHeader title="Knowledge Base" description="Manage knowledge entries for agents">
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Link to="/kb/sources">
              <Button variant="outline">
                <Database className="mr-2 h-4 w-4" />
                Sources
              </Button>
            </Link>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Entry
            </Button>
          </div>
        )}
      </PageHeader>

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px]" />
          ))}
        </div>
      ) : statsError ? (
        <Card className="mb-6">
          <CardContent className="py-6 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load stats
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Entries" value={stats?.totalEntries ?? 0} color="blue" />
          <StatCard label="Pending Review" value={stats?.pendingEntries ?? 0} color="amber" />
          <StatCard label="Categories" value={stats?.categories ?? 0} color="green" />
          <StatCard label="Sources" value={stats?.sourcesCount ?? (sources ?? []).length ?? 0} color="blue" />
        </div>
      )}

      {/* Source Cards (when no source selected) */}
      {!activeSource && !search && (
        <div className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(sources ?? []).map((src) => (
              <Card
                key={src.id}
                className="cursor-pointer transition-colors hover:bg-warm-bg/50"
                onClick={() => { setActiveSource(src.id); setPage(1); }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <FolderOpen className="h-5 w-5 text-brand mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm truncate">{src.name}</h3>
                      <p className="text-xs text-warm-text-secondary mt-0.5">{getSourceTypeName(src.type)}</p>
                      <p className="text-xs text-warm-text-secondary mt-1">
                        {src.entriesCount ?? 0} entries
                        {src.lastSyncAt && <> &middot; synced {formatDistanceToNow(new Date(src.lastSyncAt), { addSuffix: true })}</>}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {manualCount > 0 && (
              <Card
                className="cursor-pointer transition-colors hover:bg-warm-bg/50"
                onClick={() => { setActiveSource('manual'); setPage(1); }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-warm-text-secondary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm">Manual Entries</h3>
                      <p className="text-xs text-warm-text-secondary mt-0.5">Added manually</p>
                      <p className="text-xs text-warm-text-secondary mt-1">{manualCount} entries</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Breadcrumb when viewing a source */}
      {activeSource && (
        <div className="flex items-center gap-2 mb-4">
          <button
            className="text-sm text-warm-text-secondary hover:text-warm-text flex items-center gap-1"
            onClick={() => { setActiveSource(null); setSearch(''); setPage(1); }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Sources
          </button>
          <span className="text-warm-text-secondary">/</span>
          <span className="text-sm font-medium">{activeSourceName}</span>
          <Badge variant="secondary" className="text-xs ml-1">{total} entries</Badge>
        </div>
      )}

      {/* Search + Filters (always shown when inside a source or searching) */}
      {(activeSource || search) && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
            <Input
              placeholder="Search entries..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
          <Select value={category} onValueChange={(v) => { setCategory(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {(categories ?? []).map((cat) => (
                <SelectItem key={cat} value={cat}>{titleCase(cat)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Global search bar (when no source selected and not searching yet) */}
      {!activeSource && !search && (
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
            <Input
              placeholder="Search all entries..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9"
            />
          </div>
        </div>
      )}

      {/* Entry list (shown when a source is selected or searching) */}
      {(activeSource || search) && (
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="approved">Published</TabsTrigger>
            {isAdmin && <TabsTrigger value="pending">Pending Review</TabsTrigger>}
          </TabsList>

          <TabsContent value={tab}>
            {isLoading ? (
              <Skeleton className="h-[300px]" />
            ) : isError ? (
              <Card>
                <CardContent className="py-8 text-center text-red-500">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                  Failed to load entries
                </CardContent>
              </Card>
            ) : entries.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title={approved ? 'No entries yet' : 'No pending entries'}
                description={approved ? 'Add knowledge base entries for your agents' : 'All entries have been reviewed'}
                action={approved && isAdmin ? { label: 'Add Entry', onClick: () => setShowAdd(true) } : undefined}
              />
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        {!activeSource && <TableHead>Source</TableHead>}
                        <TableHead>Category</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry) => (
                        <TableRow
                          key={entry.id}
                          className="cursor-pointer"
                          onClick={() =>
                            setDetailEntry({
                              id: entry.id,
                              title: entry.title || 'Untitled',
                              content: entry.content || '',
                              category: entry.category || 'Uncategorized',
                              createdBy: entry.createdBy || '',
                              updatedAt: entry.updatedAt || '',
                              kbSourceId: (entry as any).kbSourceId || null,
                              sourceName: (entry as any).sourceName || null,
                            })
                          }
                        >
                          <TableCell>
                            <p className="font-medium">{entry.title || 'Untitled'}</p>
                            <p className="text-xs text-warm-text-secondary line-clamp-1 max-w-[300px]">
                              {entry.content || ''}
                            </p>
                          </TableCell>
                          {!activeSource && (
                            <TableCell className="text-warm-text-secondary text-xs">
                              {(entry as any).sourceName || 'Manual'}
                            </TableCell>
                          )}
                          <TableCell>
                            {entry.category ? (
                              <Badge variant="secondary">{titleCase(entry.category)}</Badge>
                            ) : (
                              <span className="text-warm-text-secondary text-xs">Uncategorized</span>
                            )}
                          </TableCell>
                          <TableCell className="text-warm-text-secondary text-xs">
                            {entry.updatedAt
                              ? formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })
                              : '\u2014'}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    setDetailEntry({
                                      id: entry.id,
                                      title: entry.title || 'Untitled',
                                      content: entry.content || '',
                                      category: entry.category || 'Uncategorized',
                                      createdBy: entry.createdBy || '',
                                      updatedAt: entry.updatedAt || '',
                                      kbSourceId: (entry as any).kbSourceId || null,
                                      sourceName: (entry as any).sourceName || null,
                                    })
                                  }
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  View
                                </DropdownMenuItem>
                                {!entry.approved && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      approveEntry.mutate(entry.id, {
                                        onSuccess: () => toast({ title: 'Entry approved', variant: 'success' }),
                                      })
                                    }
                                  >
                                    <Check className="mr-2 h-4 w-4" />
                                    Approve
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="text-red-600"
                                  onClick={() => {
                                    if (confirm(`Delete "${entry.title}"?`)) {
                                      deleteEntry.mutate(entry.id, {
                                        onSuccess: () => toast({ title: 'Entry deleted', variant: 'success' }),
                                      });
                                    }
                                  }}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-warm-text-secondary">{total} entries</p>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                        <span className="text-sm text-warm-text-secondary">Page {page} of {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Add Entry Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Knowledge Base Entry</DialogTitle>
            <DialogDescription>Create a new entry for agents to reference</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="mt-1" placeholder="Entry title" />
            </div>
            <div>
              <Label>Category</Label>
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="mt-1" placeholder="e.g. procedures, faq" />
              <p className="text-xs text-warm-text-secondary mt-1">Group related entries together</p>
            </div>
            <div>
              <Label>Tags</Label>
              <Input value={newTags} onChange={(e) => setNewTags(e.target.value)} className="mt-1" placeholder="e.g. onboarding, setup (comma separated)" />
              <p className="text-xs text-warm-text-secondary mt-1">Optional tags for better searchability</p>
            </div>
            <div>
              <Label>Content *</Label>
              <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} className="mt-1" rows={10} placeholder="Entry content..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createEntry.isPending}>Create Entry</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Entry Detail Dialog */}
      <Dialog open={!!detailEntry} onOpenChange={() => { setDetailEntry(null); setEditMode(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editMode ? 'Edit Entry' : detailEntry?.title}</DialogTitle>
            <DialogDescription>
              <span className="flex items-center gap-2 mt-1">
                {detailEntry?.category && <Badge variant="secondary">{titleCase(detailEntry.category)}</Badge>}
                {detailEntry?.sourceName && <Badge variant="default" className="text-[10px]">{detailEntry.sourceName}</Badge>}
                <span className="text-xs">
                  {detailEntry?.updatedAt ? formatDistanceToNow(new Date(detailEntry.updatedAt), { addSuffix: true }) : ''}
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          {editMode ? (
            <div className="space-y-3">
              <div>
                <Label>Title</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Category</Label>
                <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>Content</Label>
                <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={12} className="mt-1" />
              </div>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-sm bg-warm-bg rounded-lg p-4">
              {detailEntry?.content}
            </div>
          )}
          <DialogFooter>
            {editMode ? (
              <>
                <Button variant="outline" onClick={() => setEditMode(false)}>Cancel</Button>
                <Button onClick={() => {
                  if (!detailEntry) return;
                  updateEntry.mutate(
                    { id: detailEntry.id, title: editTitle, content: editContent, category: editCategory },
                    {
                      onSuccess: () => {
                        toast({ title: 'Entry updated', variant: 'success' });
                        setDetailEntry(null);
                        setEditMode(false);
                      },
                    },
                  );
                }} disabled={updateEntry.isPending}>Save</Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setDetailEntry(null); setEditMode(false); }}>Close</Button>
                {isAdmin && !detailEntry?.kbSourceId && (
                  <Button variant="outline" onClick={() => {
                    setEditTitle(detailEntry?.title ?? '');
                    setEditContent(detailEntry?.content ?? '');
                    setEditCategory(detailEntry?.category ?? '');
                    setEditMode(true);
                  }}>Edit</Button>
                )}
                {isAdmin && detailEntry?.kbSourceId && (
                  <p className="text-xs text-warm-text-secondary mr-auto">Auto-synced entries cannot be edited</p>
                )}
                {isAdmin && (
                  <Button variant="danger" size="sm" onClick={() => {
                    if (!detailEntry) return;
                    if (confirm(`Delete "${detailEntry.title}"?${detailEntry.kbSourceId ? ' This entry will not be re-synced.' : ''}`)) {
                      deleteEntry.mutate(detailEntry.id, {
                        onSuccess: () => {
                          toast({ title: 'Entry deleted', variant: 'success' });
                          setDetailEntry(null);
                        },
                      });
                    }
                  }}>Delete</Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
