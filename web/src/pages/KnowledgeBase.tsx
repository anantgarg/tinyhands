import { useState } from 'react';
import { BookOpen, Plus, Search, Check, Trash2, MoreVertical } from 'lucide-react';
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
} from '@/api/kb';
import { toast } from '@/components/ui/use-toast';

export function KnowledgeBase() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [tab, setTab] = useState('approved');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('');

  const approved = tab === 'approved';
  const { data: stats, isLoading: statsLoading } = useKBStats();
  const { data: categories } = useKBCategories();
  const { data, isLoading } = useKBEntries({
    page,
    limit: 20,
    category: category !== 'all' ? category : undefined,
    approved,
    search: search || undefined,
  });

  const createEntry = useCreateKBEntry();
  const approveEntry = useApproveKBEntry();
  const deleteEntry = useDeleteKBEntry();

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleCreate = () => {
    if (!newTitle.trim() || !newContent.trim()) {
      toast({ title: 'Title and content are required', variant: 'error' });
      return;
    }
    createEntry.mutate(
      { title: newTitle, content: newContent, category: newCategory || undefined },
      {
        onSuccess: () => {
          toast({ title: 'Entry created', variant: 'success' });
          setShowAdd(false);
          setNewTitle('');
          setNewContent('');
          setNewCategory('');
        },
      },
    );
  };

  return (
    <div>
      <PageHeader title="Knowledge Base" description="Manage knowledge entries for agents">
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
      </PageHeader>

      {/* Stats */}
      {statsLoading ? (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[80px]" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Entries" value={stats?.totalEntries ?? 0} color="blue" />
          <StatCard label="Pending Review" value={stats?.pendingEntries ?? 0} color="amber" />
          <StatCard label="Categories" value={stats?.categories ?? 0} color="green" />
          <StatCard label="Sources" value={stats?.sourcesCount ?? 0} color="blue" />
        </div>
      )}

      {/* Filters */}
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
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
        <TabsList>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
        </TabsList>

        <TabsContent value={tab}>
          {isLoading ? (
            <Skeleton className="h-[300px]" />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={approved ? 'No entries yet' : 'No pending entries'}
              description={approved ? 'Add knowledge base entries for your agents' : 'All entries have been reviewed'}
              action={approved ? { label: 'Add Entry', onClick: () => setShowAdd(true) } : undefined}
            />
          ) : (
            <Card>
              <CardContent className="pt-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Created By</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-xs text-warm-text-secondary line-clamp-1 max-w-[300px]">
                            {entry.content}
                          </p>
                        </TableCell>
                        <TableCell>
                          {entry.category ? (
                            <Badge variant="secondary">{entry.category}</Badge>
                          ) : (
                            <span className="text-warm-text-secondary text-xs">Uncategorized</span>
                          )}
                        </TableCell>
                        <TableCell className="text-warm-text-secondary">{entry.createdBy}</TableCell>
                        <TableCell className="text-warm-text-secondary text-xs">
                          {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
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
    </div>
  );
}
