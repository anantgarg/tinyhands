import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Trash2, Plus, Key, Copy, AlertCircle,
  Github, Globe, FileText, Database, BookOpen,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
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

const SOURCE_TYPES = [
  { id: 'github', name: 'GitHub Repository', description: 'Sync markdown files from a GitHub repository', icon: Github },
  { id: 'google_drive', name: 'Google Drive', description: 'Import documents from Google Drive folders', icon: FileText },
  { id: 'zendesk', name: 'Zendesk Help Center', description: 'Sync articles from Zendesk Help Center', icon: BookOpen },
  { id: 'web_crawl', name: 'Web Crawl', description: 'Crawl and index web pages', icon: Globe },
  { id: 'notion', name: 'Notion', description: 'Sync pages from a Notion workspace', icon: Database },
];

const SOURCE_CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string; required: boolean }[]> = {
  github: [
    { key: 'repo', label: 'Repository (owner/name)', placeholder: 'myorg/docs', required: true },
    { key: 'branch', label: 'Branch', placeholder: 'main', required: false },
    { key: 'path', label: 'Path filter', placeholder: 'docs/', required: false },
  ],
  google_drive: [
    { key: 'folderId', label: 'Folder ID', placeholder: 'The Google Drive folder ID', required: true },
  ],
  zendesk: [
    { key: 'subdomain', label: 'Subdomain', placeholder: 'yourcompany', required: true },
    { key: 'categoryId', label: 'Category ID (optional)', placeholder: '', required: false },
  ],
  web_crawl: [
    { key: 'url', label: 'Start URL', placeholder: 'https://docs.example.com', required: true },
    { key: 'maxPages', label: 'Max pages', placeholder: '50', required: false },
    { key: 'urlPattern', label: 'URL pattern (regex)', placeholder: '/docs/.*', required: false },
  ],
  notion: [
    { key: 'rootPageId', label: 'Root Page ID', placeholder: 'Notion page ID', required: true },
  ],
};

function getSourceTypeName(type: string | null): string {
  const names: Record<string, string> = {
    github: 'GitHub',
    google_drive: 'Google Drive',
    zendesk: 'Zendesk',
    web_crawl: 'Website',
    notion: 'Notion',
  };
  return type ? names[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown';
}

function getStatusLabel(status: string | null): string {
  const labels: Record<string, string> = {
    active: 'Active',
    syncing: 'Syncing',
    needs_setup: 'Setup Required',
    error: 'Error',
    pending: 'Pending',
    disabled: 'Disabled',
  };
  return status ? labels[status] ?? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown';
}

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

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardType, setWizardType] = useState('');
  const [wizardName, setWizardName] = useState('');
  const [wizardConfig, setWizardConfig] = useState<Record<string, string>>({});
  const [wizardAutoSync, setWizardAutoSync] = useState(true);
  const [wizardCategory, setWizardCategory] = useState('');

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

  const openWizard = () => {
    setWizardStep(1);
    setWizardType('');
    setWizardName('');
    setWizardConfig({});
    setWizardAutoSync(true);
    setWizardCategory('');
    setShowWizard(true);
  };

  const handleWizardCreate = () => {
    if (!wizardName.trim()) {
      toast({ title: 'Source name is required', variant: 'error' });
      return;
    }
    const config: Record<string, unknown> = { ...wizardConfig };
    if (wizardAutoSync) config.autoSync = true;
    if (wizardCategory) config.category = wizardCategory;

    createSource.mutate(
      { name: wizardName, type: wizardType, config },
      {
        onSuccess: () => {
          toast({ title: 'Source created', variant: 'success' });
          setShowWizard(false);
        },
        onError: (err) => toast({ title: 'Failed to create source', description: err.message, variant: 'error' }),
      },
    );
  };

  const selectedType = SOURCE_TYPES.find((t) => t.id === wizardType);
  const configFields = SOURCE_CONFIG_FIELDS[wizardType] ?? [];

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
          <div className="rounded-card border border-warm-border bg-white">
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
          </div>
        )}
      </section>

      {/* Connected Sources */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Connected Sources</h2>
          <Button size="sm" onClick={openWizard}>
            <Plus className="mr-2 h-4 w-4" />
            Add Source
          </Button>
        </div>
        {sourcesLoading ? (
          <Skeleton className="h-[200px]" />
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
            action={{ label: 'Add Source', onClick: openWizard }}
          />
        ) : (
          <div className="rounded-card border border-warm-border bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sources ?? []).map((source) => (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name ?? 'Unnamed Source'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getSourceTypeName(source.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.status === 'active' ? 'success' : source.status === 'syncing' ? 'warning' : source.status === 'error' ? 'danger' : 'secondary'}>
                        {getStatusLabel(source.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{source.entriesCount ?? 0}</TableCell>
                    <TableCell className="text-warm-text-secondary text-sm">
                      {source.lastSyncAt
                        ? formatDistanceToNow(new Date(source.lastSyncAt), { addSuffix: true })
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => handleSync(source.id)} disabled={syncSource.isPending}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500"
                          onClick={() => handleDeleteSource(source.id, source.name ?? 'source')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

      {/* Add Source Wizard Dialog */}
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {wizardStep === 1 && 'Choose Source Type'}
              {wizardStep === 2 && `Configure ${selectedType?.name ?? 'Source'}`}
              {wizardStep === 3 && 'Sync Settings'}
              {wizardStep === 4 && 'Review & Create'}
            </DialogTitle>
            <DialogDescription>
              Step {wizardStep} of 4
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Source type selection */}
          {wizardStep === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {SOURCE_TYPES.map((type) => {
                const Icon = type.icon;
                return (
                  <button
                    key={type.id}
                    onClick={() => {
                      setWizardType(type.id);
                      setWizardConfig({});
                      setWizardStep(2);
                    }}
                    className={`flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:bg-warm-bg ${
                      wizardType === type.id ? 'border-brand bg-brand-light/20' : 'border-warm-border'
                    }`}
                  >
                    <Icon className="h-6 w-6 text-brand" />
                    <span className="text-sm font-medium">{type.name}</span>
                    <span className="text-xs text-warm-text-secondary">{type.description}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2: Type-specific config */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Source Name *</Label>
                <Input
                  value={wizardName}
                  onChange={(e) => setWizardName(e.target.value)}
                  placeholder="e.g. Company Docs"
                  className="mt-1"
                />
              </div>
              {configFields.map((field) => (
                <div key={field.key}>
                  <Label>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <Input
                    value={wizardConfig[field.key] ?? ''}
                    onChange={(e) => setWizardConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="mt-1"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Sync settings */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  checked={wizardAutoSync}
                  onCheckedChange={setWizardAutoSync}
                />
                <div>
                  <Label>Auto-sync</Label>
                  <p className="text-xs text-warm-text-secondary">Automatically sync this source on a schedule</p>
                </div>
              </div>
              <div>
                <Label>Category (optional)</Label>
                <Input
                  value={wizardCategory}
                  onChange={(e) => setWizardCategory(e.target.value)}
                  placeholder="e.g. documentation, faq"
                  className="mt-1"
                />
                <p className="text-xs text-warm-text-secondary mt-1">Group synced entries under a category</p>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {wizardStep === 4 && (
            <div className="space-y-3">
              <div className="rounded-lg border border-warm-border p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-warm-text-secondary">Name</span>
                  <span className="text-sm font-medium">{wizardName || '\u2014'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-warm-text-secondary">Type</span>
                  <span className="text-sm font-medium">{selectedType?.name || wizardType}</span>
                </div>
                {Object.entries(wizardConfig).filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-sm text-warm-text-secondary">{k}</span>
                    <span className="text-sm font-medium truncate max-w-[200px]">{v}</span>
                  </div>
                ))}
                <div className="flex justify-between">
                  <span className="text-sm text-warm-text-secondary">Auto-sync</span>
                  <span className="text-sm font-medium">{wizardAutoSync ? 'Yes' : 'No'}</span>
                </div>
                {wizardCategory && (
                  <div className="flex justify-between">
                    <span className="text-sm text-warm-text-secondary">Category</span>
                    <span className="text-sm font-medium">{wizardCategory}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {wizardStep > 1 && (
              <Button variant="outline" onClick={() => setWizardStep(wizardStep - 1)}>Back</Button>
            )}
            {wizardStep === 1 && (
              <Button variant="outline" onClick={() => setShowWizard(false)}>Cancel</Button>
            )}
            {wizardStep < 4 && wizardStep > 1 && (
              <Button
                onClick={() => setWizardStep(wizardStep + 1)}
                disabled={wizardStep === 2 && !wizardName.trim()}
              >
                Next
              </Button>
            )}
            {wizardStep === 4 && (
              <Button onClick={handleWizardCreate} disabled={createSource.isPending}>
                Create Source
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
