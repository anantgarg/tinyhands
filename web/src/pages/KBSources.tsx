import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Trash2, Plus, Key, Copy } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
  useKBSources,
  useSyncKBSource,
  useDeleteKBSource,
  useKBApiKeys,
  useSetKBApiKey,
  useDeleteKBApiKey,
} from '@/api/kb';
import { toast } from '@/components/ui/use-toast';

export function KBSources() {
  const { data: sources, isLoading: sourcesLoading } = useKBSources();
  const { data: apiKeys, isLoading: keysLoading } = useKBApiKeys();
  const syncSource = useSyncKBSource();
  const deleteSource = useDeleteKBSource();
  const createApiKey = useSetKBApiKey();
  const deleteApiKey = useDeleteKBApiKey();

  const [showNewKey, setShowNewKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  const handleSync = (id: string) => {
    syncSource.mutate(id, {
      onSuccess: () => toast({ title: 'Sync started', variant: 'success' }),
    });
  };

  const handleDeleteSource = (id: string, name: string) => {
    if (confirm(`Delete source "${name}"?`)) {
      deleteSource.mutate(id, {
        onSuccess: () => toast({ title: 'Source deleted', variant: 'success' }),
      });
    }
  };

  const handleCreateKey = () => {
    if (!keyName.trim()) return;
    createApiKey.mutate(
      { name: keyName },
      {
        onSuccess: (data) => {
          setGeneratedKey(data.key);
          setKeyName('');
          toast({ title: 'API key created', variant: 'success' });
        },
      },
    );
  };

  return (
    <div>
      <Link to="/kb" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Knowledge Base
      </Link>

      <PageHeader title="KB Sources" description="Manage knowledge base data sources and API keys" />

      {/* API Keys */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">API Keys</h2>
          <Button size="sm" onClick={() => setShowNewKey(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New API Key
          </Button>
        </div>
        {keysLoading ? (
          <Skeleton className="h-[100px]" />
        ) : (apiKeys ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-warm-text-secondary">
              No API keys created yet
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key Prefix</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(apiKeys ?? []).map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="font-medium">{key.name}</TableCell>
                      <TableCell className="font-mono text-xs">{key.prefix}...</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => {
                            if (confirm(`Delete API key "${key.name}"?`)) {
                              deleteApiKey.mutate(key.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Connected Sources */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Connected Sources</h2>
        {sourcesLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : (sources ?? []).length === 0 ? (
          <EmptyState
            icon={Key}
            title="No sources connected"
            description="Connect data sources like GitHub, Google Drive, or web crawlers to populate your knowledge base"
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {(sources ?? []).map((source) => (
              <Card key={source.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{source.name}</CardTitle>
                      <Badge variant="secondary" className="mt-1">{source.type}</Badge>
                    </div>
                    <Badge variant={source.status === 'active' ? 'success' : source.status === 'syncing' ? 'warning' : 'secondary'}>
                      {source.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-warm-text-secondary mb-3">
                    <span>{source.entriesCount} entries</span>
                    <span>
                      {source.lastSyncAt
                        ? `Last synced ${formatDistanceToNow(new Date(source.lastSyncAt), { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleSync(source.id)} disabled={syncSource.isPending}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Sync
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => handleDeleteSource(source.id, source.name)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* New API Key Dialog */}
      <Dialog open={showNewKey} onOpenChange={setShowNewKey}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Generate a new API key for external KB access</DialogDescription>
          </DialogHeader>
          {generatedKey ? (
            <div className="space-y-4">
              <p className="text-sm text-warm-text-secondary">
                Copy this key now. It will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <Input value={generatedKey} readOnly className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    navigator.clipboard.writeText(generatedKey);
                    toast({ title: 'Copied to clipboard', variant: 'success' });
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowNewKey(false); setGeneratedKey(''); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div>
                <Label>Key Name</Label>
                <Input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="e.g. Production"
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowNewKey(false)}>Cancel</Button>
                <Button onClick={handleCreateKey} disabled={createApiKey.isPending}>Create</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
