import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Database as DatabaseIcon, Plus, Trash2, AlertTriangle, RefreshCw, Upload } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { DriveSheetPicker } from '@/components/DriveSheetPicker';
import { api } from '@/api/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import {
  useDatabaseTables, useCreateDatabaseTable, useDeleteDatabaseTable,
  useImportDatabase, useSyncSheet, useSheetTabs,
  type DatabaseColumnType, type DatabaseTable, type DatabaseColumn,
} from '@/api/database';
import { usePersonalConnections, startOAuthReconnect } from '@/api/connections';

const TYPE_OPTIONS: { value: DatabaseColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'integer', label: 'Number (whole)' },
  { value: 'numeric', label: 'Number (decimal)' },
  { value: 'boolean', label: 'True / False' },
  { value: 'timestamptz', label: 'Date & time' },
  { value: 'date', label: 'Date' },
  { value: 'json', label: 'JSON' },
];

function sourceLabel(t: DatabaseTable['sourceType']): string {
  switch (t) {
    case 'csv': return 'Imported from CSV';
    case 'xlsx': return 'Imported from Excel';
    case 'google_sheet': return 'Synced from Google Sheets';
    default: return 'Created in dashboard';
  }
}

function syncIssueText(issue: { kind: string; column?: string; message?: string }): string {
  switch (issue.kind) {
    case 'unmapped_column':
      return `Column '${issue.column}' was added in the Google Sheet but hasn't been imported. Add it to the table to start syncing its values.`;
    case 'removed_column':
      return `Column '${issue.column}' was removed from the Google Sheet. Existing values are preserved but no longer syncing.`;
    case 'row_type_mismatch':
      return `Some rows couldn't be imported because their values don't match the expected type${issue.column ? ` for '${issue.column}'` : ''}.`;
    case 'auth_failed':
      return issue.message || 'Could not authenticate with Google. Reconnect Google in Tools → Personal Connections.';
    case 'fetch_failed':
      return issue.message || 'Could not fetch the spreadsheet.';
    case 'renamed_column':
      return `Column was renamed in the sheet. Map it to an existing column to keep syncing.`;
    default:
      return issue.message || 'Sync issue.';
  }
}

function SyncTriangle({ table }: { table: DatabaseTable }) {
  const issues = table.latestSync?.detail?.issues || [];
  if (!issues.length) return null;
  // Tally distinct issue kinds for the tooltip headline.
  const distinctCols = new Set(issues.filter(i => i.column).map(i => i.column));
  const tooltip = issues.length === 1
    ? syncIssueText(issues[0])
    : `${issues.length} sync issue${issues.length === 1 ? '' : 's'} (${distinctCols.size} affected column${distinctCols.size === 1 ? '' : 's'}). Open the table to resolve.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link to={`/database/${table.id}`} className="inline-flex">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function Database() {
  const { data: tables, isLoading } = useDatabaseTables();
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const deleteTable = useDeleteDatabaseTable();
  const syncSheet = useSyncSheet();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Database"
        description="Workspace tables your agents can read and write. Imports come from CSV, Excel, or a synced Google Sheet."
      >
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Import data
        </Button>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New table
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}

      {!isLoading && (!tables || tables.length === 0) && (
        <EmptyState
          icon={DatabaseIcon}
          title="No tables yet"
          description="Create a table or import a spreadsheet to give your agents structured data to work with."
          action={{ label: 'Create your first table', onClick: () => setCreateOpen(true) }}
        />
      )}

      {!isLoading && tables && tables.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Last synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tables.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link to={`/database/${t.id}`} className="font-medium text-warm-text hover:text-brand">
                          {t.name}
                        </Link>
                        <SyncTriangle table={t} />
                      </div>
                      {t.description && <div className="text-xs text-warm-text-secondary">{t.description}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{sourceLabel(t.sourceType)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-warm-text-secondary">
                      {t.lastSyncedAt ? formatDistanceToNow(new Date(t.lastSyncedAt), { addSuffix: true }) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {t.sourceType === 'google_sheet' && (
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => syncSheet.mutate(t.id, {
                            onSuccess: () => toast({ title: 'Sync started' }),
                            onError: (e: any) => toast({ title: 'Sync failed', description: e.message, variant: 'error' }),
                          })}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => {
                          if (confirm(`Delete table "${t.name}"? This cannot be undone.`)) {
                            deleteTable.mutate(t.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-warm-text-secondary" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateTableDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function CreateTableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<DatabaseColumn[]>([{ name: '', type: 'text' }]);
  const create = useCreateDatabaseTable();

  const submit = () => {
    if (!name.trim()) {
      toast({ title: 'Name is required', variant: 'error' });
      return;
    }
    const cleanCols = columns
      .filter(c => c.name.trim())
      .map(c => ({ name: c.name.trim().toLowerCase().replace(/\s+/g, '_'), type: c.type }));
    if (cleanCols.length === 0) {
      toast({ title: 'Add at least one column', variant: 'error' });
      return;
    }
    create.mutate(
      { name: name.trim().toLowerCase().replace(/\s+/g, '_'), description: description.trim() || undefined, columns: cleanCols },
      {
        onSuccess: () => {
          toast({ title: 'Table created' });
          onClose();
          setName(''); setDescription(''); setColumns([{ name: '', type: 'text' }]);
        },
        onError: (e: any) => toast({ title: 'Could not create table', description: e.message, variant: 'error' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[85vh] p-0 overflow-hidden outline-none focus:outline-none focus-visible:outline-none">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>New table</DialogTitle>
          <DialogDescription>Give your table a name and at least one column. You can add or change columns later.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 min-h-0">
          <div>
            <Label>Table name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="customers" className="max-w-xs" />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Active customer accounts" />
          </div>
          <div>
            <Label>Columns</Label>
            <div className="space-y-2 mt-1">
              {columns.map((col, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    value={col.name}
                    onChange={(e) => {
                      const next = [...columns]; next[idx] = { ...col, name: e.target.value }; setColumns(next);
                    }}
                    placeholder="column_name"
                    className="flex-1"
                  />
                  <Select
                    value={col.type}
                    onValueChange={(v) => {
                      const next = [...columns]; next[idx] = { ...col, type: v as DatabaseColumnType }; setColumns(next);
                    }}
                  >
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setColumns(columns.filter((_, i) => i !== idx))}
                    disabled={columns.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setColumns([...columns, { name: '', type: 'text' }])}>
                <Plus className="mr-2 h-4 w-4" /> Add column
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-warm-border bg-white rounded-b-lg shrink-0">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create table'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columnDescriptions, setColumnDescriptions] = useState<Record<string, string>>({});
  const [pickedSheet, setPickedSheet] = useState<{ id: string; name: string } | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const importMut = useImportDatabase();

  // Reset everything when the dialog re-opens so a stale close doesn't bleed
  // into a fresh import.
  useEffect(() => {
    if (!open) return;
    setName(''); setDescription(''); setColumnDescriptions({});
    setPickedSheet(null); setSheetName('');
  }, [open]);

  // After both a sheet and tab are picked, ask the backend to suggest a
  // table name + a detailed description by sending a sample of the data to
  // Claude. Fills both fields so the admin can edit before importing.
  useEffect(() => {
    if (!pickedSheet || !sheetName) return;
    let cancelled = false;
    setSuggesting(true);
    api
      .post<{ name: string; description: string; columns: Record<string, string> }>('/database/suggest-metadata', {
        kind: 'google_sheet',
        spreadsheetId: pickedSheet.id,
        sheetName,
      })
      .then((res) => {
        if (cancelled) return;
        // Switching tabs always overwrites — the AI suggestion is the source
        // of truth for the picked tab. The admin can edit after the fact.
        setName(res.name);
        setDescription(res.description);
        setColumnDescriptions(res.columns || {});
      })
      .catch(() => { /* suggestion is best-effort; admin can fill in manually */ })
      .finally(() => { if (!cancelled) setSuggesting(false); });
    return () => { cancelled = true; };
  }, [pickedSheet, sheetName]);

  const submit = () => {
    if (!name.trim()) { toast({ title: 'Table name is required', variant: 'error' }); return; }
    if (!pickedSheet) { toast({ title: 'Pick a Google Sheet to import', variant: 'error' }); return; }
    const tableName = name.trim().toLowerCase().replace(/\s+/g, '_');
    importMut.mutate({
      kind: 'google_sheet', name: tableName,
      description: description.trim() || undefined,
      columnDescriptions: Object.keys(columnDescriptions).length ? columnDescriptions : undefined,
      spreadsheetId: pickedSheet.id,
      sheetName: sheetName || undefined,
      syncEnabled: true,
    }, {
      onSuccess: (res: any) => {
        toast({
          title: 'Import complete',
          description: `${res?.rowsImported ?? 0} rows imported${res?.rowsSkipped ? `, ${res.rowsSkipped} skipped` : ''}.`,
        });
        onClose();
      },
      onError: (e: any) => toast({ title: 'Import failed', description: e.message, variant: 'error' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl flex flex-col max-h-[85vh] p-0 overflow-hidden outline-none focus:outline-none focus-visible:outline-none">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Import from Google Sheets</DialogTitle>
          <DialogDescription>The sheet stays in sync — TinyHands re-pulls it every 5 minutes. Name and description are auto-suggested by AI; edit before importing.</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4 min-h-0">
          <GoogleConnectionWarning />
          <div>
            <Label>Spreadsheet</Label>
            <DriveSheetPicker
              value={pickedSheet}
              onChange={(v) => { setPickedSheet(v); setSheetName(''); }}
            />
          </div>
          <SheetTabSelect spreadsheetId={pickedSheet?.id || null} value={sheetName} onChange={setSheetName} />
          <div>
            <Label>Table name {suggesting && <span className="text-xs text-warm-text-secondary font-normal ml-1">(suggesting…)</span>}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="customers" className="max-w-xs" />
          </div>
          <div>
            <Label>Description {suggesting && <span className="text-xs text-warm-text-secondary font-normal ml-1">(suggesting…)</span>}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does each row represent? Which columns matter? What questions can this answer?"
              rows={4}
            />
            <p className="text-xs text-warm-text-secondary mt-1">
              Agents read this when deciding whether to use the table — be specific about what the data covers.
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-warm-border bg-white rounded-b-lg shrink-0">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={importMut.isPending}>{importMut.isPending ? 'Importing…' : 'Import'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function SheetTabSelect({ spreadsheetId, value, onChange }: { spreadsheetId: string | null; value: string; onChange: (v: string) => void }) {
  const { data, isLoading, isError } = useSheetTabs(spreadsheetId);
  const tabs = data?.tabs || [];
  // Auto-select the first tab when tabs load and none is picked yet — so the
  // parent's `sheetName` state is populated and downstream effects (like AI
  // metadata suggestion) actually fire.
  useEffect(() => {
    if (tabs.length > 0 && !value) {
      onChange(tabs[0].title);
    }
  }, [tabs, value, onChange]);

  if (!spreadsheetId) {
    return (
      <div>
        <Label>Tab inside the spreadsheet</Label>
        <p className="text-xs text-warm-text-secondary mt-1">Pick a sheet first to choose a tab.</p>
      </div>
    );
  }

  return (
    <div>
      <Label>Tab inside the spreadsheet</Label>
      {isLoading ? (
        <p className="text-xs text-warm-text-secondary mt-1">Loading tabs…</p>
      ) : isError ? (
        <p className="text-xs text-red-500 mt-1">Couldn't load tabs from this sheet.</p>
      ) : tabs.length === 0 ? (
        <p className="text-xs text-warm-text-secondary mt-1">No tabs found.</p>
      ) : (
        <Select value={value || tabs[0].title} onValueChange={onChange}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {tabs.map((t) => (
              <SelectItem key={t.title} value={t.title}>
                {t.title}
                {t.rowCount && t.colCount ? (
                  <span className="text-warm-text-secondary text-xs ml-2">({t.rowCount}×{t.colCount})</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

// Surfaces an inline warning at the top of the Google Sheet import tab when
// the user has no Google personal connection — or when the one they have is
// in `expired`/`revoked`/broken state. We treat all four problem states the
// same: show a yellow banner with a one-click Reconnect button so the admin
// doesn't have to bounce to /tools to discover the issue. Active connections
// render nothing.
function GoogleConnectionWarning() {
  const { data: conns, isLoading } = usePersonalConnections();
  if (isLoading || !conns) return null;

  const googleIds = new Set(['google', 'google-drive', 'google-sheets']);
  const googleConns = (conns as any[]).filter((c) => googleIds.has(c.integrationId));
  const active = googleConns.find((c) => c.status === 'active' && !c.isBroken);
  if (active) return null;

  const broken = googleConns.find((c) => c.status !== 'active' || c.isBroken);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
      <div className="flex-1 text-sm text-amber-900">
        {broken ? (
          <>
            Your Google connection is {broken.status === 'expired' ? 'expired' : broken.isBroken ? 'broken' : 'revoked'}.
            Reconnect Google to import or sync sheets.
          </>
        ) : (
          <>You haven't connected Google yet. Connect Google to import or sync sheets.</>
        )}
      </div>
      <Button
        variant="secondary" size="sm"
        onClick={() => startOAuthReconnect((broken?.integrationId as string) || 'google')}
      >Reconnect Google</Button>
    </div>
  );
}
