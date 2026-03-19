import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Trash2, Plus, Key, Copy, AlertCircle } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  useCreateKBSource,
} from '@/api/kb';
import { toast } from '@/components/ui/use-toast';

export function KBSources() {
  const { data: sources, isLoading: sourcesLoading, isError: sourcesError } = useKBSources();
  const { data: apiKeys, isLoading: keysLoading, isError: keysError } = useKBApiKeys();
  const syncSource = useSyncKBSource();
  const deleteSource = useDeleteKBSource();
  const createApiKey = useSetKBApiKey();
  const deleteApiKey = useDeleteKBApiKey();
  const createSource = useCreateKBSource();

  const [showNewKey, setShowNewKey] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceType, setNewSourceType] = useState('github');
  const [newSourceConfig, setNewSourceConfig] = useState('{}');

  const handleSync = (id: string) => {
    syncSource.mutate(id, {
      onSuccess: () => toast({ title: 'Sync started', variant: 'success' }),
      onError: (err) => toast({ title: 'Sync failed', description: err.message, variant: 'error' }),
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
          setGeneratedKey(data?.key ?? '');
          setKeyName('');
          toast({ title: 'API key created', variant: 'success' });
        },
        onError: (err) => toast({ title: 'Failed to create key', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleCreateSource = () => {
    if (!newSourceName.trim()) {
      toast({ title: 'Source name is required', variant: 'error' });
      return;
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(newSourceConfig);
    } catch {
      toast({ title: 'Invalid JSON config', variant: 'error' });
      return;
    }
    createSource.mutate(
      { name: newSourceName, type: newSourceType, config },
      {
        onSuccess: () => {
          toast({ title: 'Source created', variant: 'success' });
          setShowAddSource(false);
          setNewSourceName('');
          setNewSourceConfig('{}');
        },
        onError: (err) => toast({ title: 'Failed to create source', description: err.message, variant: 'error' }),
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
        ) : keysError ? (
          <Card>
            <CardContent className="py-6 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Failed to load API keys
            </CardContent>
          </Card>
        ) : (apiKeys ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-warm-text-secondary">
              No API keys created yet. API keys allow external services to access your knowledge base.
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
                      <TableCell className="font-medium">{key.name ?? 'Unnamed'}</TableCell>
                      <TableCell className="font-mono text-xs">{key.prefix ?? '***'}...</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {key.createdAt
                          ? formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })
                          : '\u2014'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => {
                            if (confirm(`Delete API key "${key.name ?? 'this key'}"?`)) {
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connected Sources</h2>
          <Button size="sm" onClick={() => setShowAddSource(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Source
          </Button>
        </div>
        {sourcesLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px]" />
            ))}
          </div>
        ) : sourcesError ? (
          <Card>
            <CardContent className="py-6 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Failed to load sources
            </CardContent>
          </Card>
        ) : (sources ?? []).length === 0 ? (
          <EmptyState
            icon={Key}
            title="No sources connected"
            description="Connect data sources like GitHub, Google Drive, or web crawlers to populate your knowledge base automatically"
            action={{ label: 'Add Source', onClick: () => setShowAddSource(true) }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {(sources ?? []).map((source) => (
              <Card key={source.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{source.name ?? 'Unnamed Source'}</CardTitle>
                      <Badge variant="secondary" className="mt-1">{source.type ?? 'unknown'}</Badge>
                    </div>
                    <Badge variant={source.status === 'active' ? 'success' : source.status === 'syncing' ? 'warning' : 'secondary'}>
                      {source.status ?? 'unknown'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-xs text-warm-text-secondary mb-3">
                    <span>{source.entriesCount ?? 0} entries</span>
                    <span>
                      {source.lastSyncAt
                        ? `Last synced ${formatDistanceToNow(new Date(source.lastSyncAt), { addSuffix: true })}`
                        : 'Never synced'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleSync(source.id)} disabled={syncSource.isPending}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Sync Now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500"
                      onClick={() => handleDeleteSource(source.id, source.name ?? 'source')}
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

      {/* Add Source Dialog */}
      <Dialog open={showAddSource} onOpenChange={setShowAddSource}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add KB Source</DialogTitle>
            <DialogDescription>Connect a data source to auto-populate your knowledge base</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Source Name *</Label>
              <Input
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="e.g. Company Wiki"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Source Type</Label>
              <Select value={newSourceType} onValueChange={setNewSourceType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="github">GitHub Repository</SelectItem>
                  <SelectItem value="google_drive">Google Drive</SelectItem>
                  <SelectItem value="zendesk">Zendesk Help Center</SelectItem>
                  <SelectItem value="web_crawl">Web Crawl</SelectItem>
                  <SelectItem value="notion">Notion</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-warm-text-secondary mt-1">
                {newSourceType === 'github' && 'Sync markdown files from a GitHub repository'}
                {newSourceType === 'google_drive' && 'Import documents from Google Drive folders'}
                {newSourceType === 'zendesk' && 'Sync articles from Zendesk Help Center'}
                {newSourceType === 'web_crawl' && 'Crawl and index web pages'}
                {newSourceType === 'notion' && 'Sync pages from a Notion workspace'}
              </p>
            </div>
            <div>
              <Label>Configuration (JSON)</Label>
              <Input
                value={newSourceConfig}
                onChange={(e) => setNewSourceConfig(e.target.value)}
                placeholder='{"url": "...", "token": "..."}'
                className="mt-1 font-mono"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Source-specific configuration as JSON</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSource(false)}>Cancel</Button>
            <Button onClick={handleCreateSource} disabled={createSource.isPending}>Add Source</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
