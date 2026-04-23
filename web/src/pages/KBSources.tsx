import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Trash2, Plus, Key, AlertCircle, Pencil,
  Github, Globe, FileText, Database, BookOpen, AlertTriangle, Sparkles,
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
  useUpdateKBSource,
  useCreateKBSource,
  useDriveFolderName,
  useKBSourceSkipLog,
  useReparseKBSource,
} from '@/api/kb';
import { DriveFolderPicker } from '@/components/DriveFolderPicker';
import { toast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { usePersonalConnections } from '@/api/connections';

const SOURCE_TYPES = [
  { id: 'google_drive', name: 'Google Drive', description: 'Import documents from Google Drive folders', icon: FileText, comingSoon: false },
  { id: 'github', name: 'GitHub Repository', description: 'Sync markdown files from a GitHub repository', icon: Github, comingSoon: true },
  { id: 'zendesk', name: 'Zendesk Help Center', description: 'Sync articles from Zendesk Help Center', icon: BookOpen, comingSoon: true },
  { id: 'web_crawl', name: 'Web Crawl', description: 'Crawl and index web pages', icon: Globe, comingSoon: true },
  { id: 'notion', name: 'Notion', description: 'Sync pages from a Notion workspace', icon: Database, comingSoon: true },
];

const SOURCE_CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder?: string; required: boolean; help?: string; type?: 'text' | 'checkbox' }[]> = {
  github: [
    { key: 'repo', label: 'Repository (owner/name)', placeholder: 'myorg/docs', required: true, help: 'The GitHub repository to sync, e.g. "acme/knowledge-base"' },
    { key: 'branch', label: 'Branch', placeholder: 'main', required: false, help: 'Branch to sync from. Defaults to the repo\'s default branch.' },
    { key: 'path', label: 'Path filter', placeholder: 'docs/', required: false, help: 'Only sync files under this path. Leave blank to sync all markdown files.' },
  ],
  google_drive: [
    { key: 'folderId', label: 'Folder', placeholder: 'Pick a Google Drive folder', required: true, help: 'Browse and pick a folder to sync into the knowledge base.' },
    { key: 'include_subfolders', label: 'Include sub-folders', required: false, type: 'checkbox', help: 'Also sync files inside nested folders at any depth.' },
  ],
  zendesk: [
    { key: 'subdomain', label: 'Subdomain', placeholder: 'yourcompany', required: true, help: 'Your Zendesk subdomain, e.g. "acme" from acme.zendesk.com' },
    { key: 'categoryId', label: 'Category ID (optional)', placeholder: '', required: false, help: 'Only sync articles from this Help Center category. Leave blank for all.' },
  ],
  web_crawl: [
    { key: 'url', label: 'Start URL', placeholder: 'https://docs.example.com', required: true, help: 'The starting page to crawl. The crawler will follow links from here.' },
    { key: 'maxPages', label: 'Max pages', placeholder: '50', required: false, help: 'Maximum number of pages to crawl. Defaults to 50.' },
    { key: 'urlPattern', label: 'URL pattern (regex)', placeholder: '/docs/.*', required: false, help: 'Only crawl URLs matching this pattern. Leave blank to follow all links.' },
  ],
  notion: [
    { key: 'rootPageId', label: 'Root Page ID', placeholder: 'Notion page ID', required: true, help: 'The ID of the top-level page to sync. Found in the page\'s URL after the workspace name.' },
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

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
  const currentUser = useAuthStore((s) => s.user);
  const { data: sources, isLoading: sourcesLoading, isError: sourcesError } = useKBSources();
  const { data: personalConns } = usePersonalConnections();
  const hasGoogleDriveConnection = ((personalConns ?? []) as any[]).some(
    (c) => c.integrationId === 'google-drive' && c.status === 'active',
  );
  const syncSource = useSyncKBSource();
  const deleteSource = useDeleteKBSource();
  const createSource = useCreateKBSource();
  const reparseSource = useReparseKBSource();

  const updateSource = useUpdateKBSource();

  // Skip-log modal state — the icon only appears on a row when the source
  // has one or more file-level failures from recent syncs. Clicking opens
  // this modal and loads the detailed list lazily.
  const [skipLogFor, setSkipLogFor] = useState<{ id: string; name: string } | null>(null);
  const { data: skipLog, isLoading: skipLogLoading } = useKBSourceSkipLog(skipLogFor?.id ?? null);

  // Edit source state
  const [editSource, setEditSource] = useState<{ id: string; name: string; type: string; config: Record<string, unknown> } | null>(null);
  const [editName, setEditName] = useState('');
  const [editConfig, setEditConfig] = useState<Record<string, string>>({});
  const [editFolderName, setEditFolderName] = useState('');
  const [editAutoSync, setEditAutoSync] = useState(true);
  const [editInterval, setEditInterval] = useState(24);

  // Lazy-load folder name for existing Google Drive sources that were created
  // before we started persisting folderName alongside folderId in config.
  const folderIdNeedingName =
    editSource?.type === 'google_drive' && editConfig.folderId && !editFolderName
      ? editConfig.folderId
      : null;
  const { data: folderNameLookup } = useDriveFolderName(folderIdNeedingName);
  useEffect(() => {
    if (folderNameLookup?.name && !editFolderName) {
      setEditFolderName(folderNameLookup.name);
    }
  }, [folderNameLookup, editFolderName]);

  // Wizard state
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardType, setWizardType] = useState('');
  const [wizardName, setWizardName] = useState('');
  const [wizardConfig, setWizardConfig] = useState<Record<string, string>>({});
  const [wizardFolderName, setWizardFolderName] = useState('');
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

  const handleReparse = (id: string, name: string) => {
    const msg = `Re-parse every file in "${name}" with current settings? This may take a while and, if Reducto is turned on, will use Reducto credits.`;
    if (!confirm(msg)) return;
    reparseSource.mutate(id, {
      onSuccess: () => toast({ title: 'Re-parse started', variant: 'success' }),
      onError: (err) => toast({ title: 'Re-parse failed', description: err.message, variant: 'error' }),
    });
  };

  const openWizard = () => {
    setWizardStep(1);
    setWizardType('');
    setWizardName('');
    setWizardConfig({});
    setWizardFolderName('');
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
    if (wizardType === 'google_drive' && wizardFolderName) config.folderName = wizardFolderName;

    createSource.mutate(
      { name: wizardName, sourceType: wizardType, config },
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

      <PageHeader title="KB Sources" description="Connect data sources to populate your knowledge base" />

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
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{source.name ?? 'Unnamed Source'}</span>
                        {(source.skippedCount ?? 0) > 0 && (
                          <button
                            type="button"
                            title={`${source.skippedCount} file${source.skippedCount === 1 ? '' : 's'} could not be indexed — click to see the list`}
                            onClick={() => setSkipLogFor({ id: source.id, name: source.name ?? 'source' })}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {source.skippedCount}
                          </button>
                        )}
                      </div>
                      {source.status === 'error' && source.errorMessage && (
                        <div className="mt-1.5 max-w-xl space-y-1.5">
                          <div className="text-xs text-warm-text-secondary leading-snug">
                            {source.errorMessage}
                          </div>
                          {source.errorFix?.kind === 'reconnect' && (
                            <Button
                              asChild
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs"
                            >
                              <Link to="/tools?tab=personal" onClick={(e) => e.stopPropagation()}>
                                <RefreshCw className="h-3 w-3 mr-1.5" />
                                Reconnect Google Drive
                              </Link>
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
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
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Edit"
                          onClick={() => {
                            const cfg = source.config ?? {};
                            const stringCfg: Record<string, string> = {};
                            for (const [k, v] of Object.entries(cfg)) {
                              if (typeof v === 'string') stringCfg[k] = v;
                            }
                            setEditSource({ id: source.id, name: source.name, type: source.type, config: cfg });
                            setEditName(source.name ?? '');
                            setEditConfig(stringCfg);
                            setEditFolderName(typeof (cfg as any).folderName === 'string' ? (cfg as any).folderName : '');
                            setEditAutoSync((source as any).autoSync ?? (source as any).auto_sync ?? true);
                            setEditInterval(Number((source as any).syncIntervalHours ?? (source as any).sync_interval_hours ?? 24));
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Sync now" onClick={() => handleSync(source.id)} disabled={syncSource.isPending}>
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Re-parse all files with current settings (useful after turning Reducto on or off)"
                          onClick={() => handleReparse(source.id, source.name ?? 'source')}
                          disabled={reparseSource.isPending}
                        >
                          <Sparkles className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete"
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

      {/* Skipped Files Dialog — shown only when the icon on a row is clicked */}
      <Dialog open={!!skipLogFor} onOpenChange={(open) => { if (!open) setSkipLogFor(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Files not indexed — {skipLogFor?.name}</DialogTitle>
            <DialogDescription>
              These files couldn't be added to the knowledge base on the most recent syncs.
              Files disappear from this list as soon as they sync successfully.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {skipLogLoading ? (
              <div className="py-8 text-center text-sm text-warm-text-secondary">Loading…</div>
            ) : (skipLog ?? []).length === 0 ? (
              <div className="py-8 text-center text-sm text-warm-text-secondary">No skipped files.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-32">Size</TableHead>
                    <TableHead className="w-40">Last attempted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(skipLog ?? []).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium break-all">{row.filename}</TableCell>
                      <TableCell>
                        <div className="text-sm">{row.reasonLabel}</div>
                        <div className="text-xs text-warm-text-secondary mt-0.5">{row.message}</div>
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">{formatBytes(row.sizeBytes)}</TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">
                        {formatDistanceToNow(new Date(row.lastSeenAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSkipLogFor(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Source Dialog */}
      <Dialog open={!!editSource} onOpenChange={() => setEditSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Source</DialogTitle>
            <DialogDescription>Update the name or configuration for this source.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Source Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1" />
            </div>
            {(SOURCE_CONFIG_FIELDS[editSource?.type ?? ''] ?? []).map((field) => {
              if (field.type === 'checkbox') {
                const checked = editConfig[field.key] === 'true';
                return (
                  <div key={field.key} className="flex items-center gap-3">
                    <Switch
                      checked={checked}
                      onCheckedChange={(next) =>
                        setEditConfig((prev) => ({ ...prev, [field.key]: next ? 'true' : 'false' }))
                      }
                    />
                    <div>
                      <Label>{field.label}</Label>
                      {field.help && <p className="text-xs text-warm-text-secondary">{field.help}</p>}
                    </div>
                  </div>
                );
              }
              return (
                <div key={field.key}>
                  <Label>{field.label}</Label>
                  {editSource?.type === 'google_drive' && field.key === 'folderId' ? (
                    <div className="mt-1">
                      <DriveFolderPicker
                        value={editConfig.folderId ?? ''}
                        valueName={editFolderName}
                        onChange={(id, name) => {
                          setEditConfig((prev) => ({ ...prev, folderId: id }));
                          setEditFolderName(name);
                        }}
                        helpText={field.help}
                      />
                    </div>
                  ) : (
                    <>
                      <Input
                        value={editConfig[field.key] ?? ''}
                        onChange={(e) => setEditConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className="mt-1"
                      />
                      {field.help && <p className="text-xs text-warm-text-secondary mt-1">{field.help}</p>}
                    </>
                  )}
                </div>
              );
            })}

            <div className="border-t border-warm-border pt-4">
              <div className="flex items-center gap-3 mb-3">
                <Switch checked={editAutoSync} onCheckedChange={setEditAutoSync} />
                <div>
                  <Label>Auto-sync</Label>
                  <p className="text-xs text-warm-text-secondary">Pull fresh content on a schedule. Turn off to sync only on demand.</p>
                </div>
              </div>
              {editAutoSync && (
                <div>
                  <Label>Sync frequency</Label>
                  <select
                    value={editInterval}
                    onChange={(e) => setEditInterval(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-warm-border bg-white px-3 py-2 text-sm"
                  >
                    <option value={1}>Every hour</option>
                    <option value={6}>Every 6 hours</option>
                    <option value={12}>Every 12 hours</option>
                    <option value={24}>Every 24 hours</option>
                    <option value={168}>Every week</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSource(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editSource) return;
                // Strip schedule keys out of config blob — they live in their own columns.
                const mergedConfig: Record<string, unknown> = {
                  ...editSource.config,
                  ...editConfig,
                };
                if (editSource.type === 'google_drive') {
                  mergedConfig.folderName = editFolderName;
                }
                delete (mergedConfig as any).autoSync;
                delete (mergedConfig as any).syncIntervalHours;
                updateSource.mutate(
                  {
                    id: editSource.id,
                    name: editName,
                    config: mergedConfig,
                    autoSync: editAutoSync,
                    syncIntervalHours: editInterval,
                  },
                  {
                    onSuccess: () => {
                      toast({ title: 'Source updated', variant: 'success' });
                      setEditSource(null);
                    },
                    onError: (err) => toast({ title: 'Update failed', description: err.message, variant: 'error' }),
                  },
                );
              }}
              disabled={updateSource.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
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
                const disabled = type.comingSoon;
                return (
                  <button
                    key={type.id}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      setWizardType(type.id);
                      setWizardConfig({});
                      if (type.id === 'google_drive' && currentUser?.displayName) {
                        const first = currentUser.displayName.split(' ')[0];
                        setWizardName(`${first}'s Google Drive`);
                      }
                      setWizardStep(2);
                    }}
                    className={`relative flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors ${
                      disabled
                        ? 'cursor-not-allowed border-warm-border bg-warm-bg/40 opacity-60'
                        : `hover:bg-warm-bg ${wizardType === type.id ? 'border-brand bg-brand-light/20' : 'border-warm-border'}`
                    }`}
                  >
                    {disabled && (
                      <span className="absolute top-2 right-2 rounded-full bg-warm-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warm-text-secondary">
                        Coming soon
                      </span>
                    )}
                    <Icon className={`h-6 w-6 ${disabled ? 'text-warm-text-secondary' : 'text-brand'}`} />
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
              {wizardType === 'google_drive' && !hasGoogleDriveConnection && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium mb-1">Connect Google first</p>
                  <p className="text-amber-800">
                    You haven't connected your Google account yet. Head to <Link to="/tools?tab=personal" className="underline font-medium">Tools → Personal</Link> and connect Google, then come back here.
                  </p>
                </div>
              )}
              <div>
                <Label>Source Name *</Label>
                <Input
                  value={wizardName}
                  onChange={(e) => setWizardName(e.target.value)}
                  placeholder="e.g. Company Docs"
                  className="mt-1"
                />
              </div>
              {configFields.map((field) => {
                if (field.type === 'checkbox') {
                  const checked = wizardConfig[field.key] === 'true';
                  return (
                    <div key={field.key} className="flex items-center gap-3">
                      <Switch
                        checked={checked}
                        onCheckedChange={(next) =>
                          setWizardConfig((prev) => {
                            if (next) return { ...prev, [field.key]: 'true' };
                            const rest = { ...prev };
                            delete rest[field.key];
                            return rest;
                          })
                        }
                      />
                      <div>
                        <Label>{field.label}</Label>
                        {field.help && <p className="text-xs text-warm-text-secondary">{field.help}</p>}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={field.key}>
                    <Label>
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    {wizardType === 'google_drive' && field.key === 'folderId' ? (
                      <div className="mt-1 space-y-2">
                        <DriveFolderPicker
                          value={wizardConfig.folderId ?? ''}
                          valueName={wizardFolderName}
                          onChange={(id, name) => {
                            setWizardConfig((prev) => ({ ...prev, folderId: id }));
                            setWizardFolderName(name);
                            if (name && !wizardName) setWizardName(name);
                          }}
                          helpText={field.help}
                        />
                        <p className="text-xs text-warm-text-secondary">
                          Folders are browsed through your personal Google connection. The knowledge base itself is shared across the workspace.
                        </p>
                      </div>
                    ) : (
                      <>
                        <Input
                          value={wizardConfig[field.key] ?? ''}
                          onChange={(e) => setWizardConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          className="mt-1"
                        />
                        {field.help && <p className="text-xs text-warm-text-secondary mt-1">{field.help}</p>}
                      </>
                    )}
                  </div>
                );
              })}
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
                  <Label>Auto-sync every 24 hours</Label>
                  <p className="text-xs text-warm-text-secondary">Pull fresh content once a day. Turn off to sync only on demand.</p>
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
                {Object.entries(wizardConfig).filter(([, v]) => v).map(([k, v]) => {
                  const isDriveFolder = wizardType === 'google_drive' && k === 'folderId';
                  const isSubfolders = wizardType === 'google_drive' && k === 'include_subfolders';
                  const label = isDriveFolder ? 'Folder' : isSubfolders ? 'Include sub-folders' : k;
                  const display = isDriveFolder && wizardFolderName
                    ? wizardFolderName
                    : isSubfolders
                      ? (v === 'true' ? 'Yes' : 'No')
                      : v;
                  return (
                    <div key={k} className="flex justify-between">
                      <span className="text-sm text-warm-text-secondary">{label}</span>
                      <span className="text-sm font-medium truncate max-w-[200px]">{display}</span>
                    </div>
                  );
                })}
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
