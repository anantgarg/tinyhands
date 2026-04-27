import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Plus, Trash2, AlertTriangle, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { Textarea } from '@/components/ui/textarea';
import {
  useDatabaseTable, useDatabaseRows, useColumnOp, useSyncSheet,
  useIgnoreColumn, useMapColumn, useInsertRow, useUpdateRow, useDeleteRow,
  useUpdateColumnDescription, useSuggestColumnDescriptions,
  type DatabaseColumnType,
} from '@/api/database';

const TYPE_LABELS: Record<DatabaseColumnType, string> = {
  text: 'Text', integer: 'Number (whole)', bigint: 'Number (large whole)',
  numeric: 'Number (decimal)', boolean: 'True / False',
  timestamptz: 'Date & time', date: 'Date', json: 'JSON',
};

const TYPE_OPTIONS: DatabaseColumnType[] = ['text', 'integer', 'numeric', 'boolean', 'timestamptz', 'date', 'json'];

export function DatabaseTable() {
  const { id } = useParams<{ id: string }>();
  const { data: table, isLoading } = useDatabaseTable(id || null);
  const { data: rowsData } = useDatabaseRows(id || null, { limit: 100 });
  const [addColOpen, setAddColOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const syncSheet = useSyncSheet();

  if (isLoading || !table) {
    return <Skeleton className="h-32 w-full" />;
  }

  const issues = table.latestSync?.detail?.issues || [];

  return (
    <div className="space-y-6">
      <Link to="/database" className="text-sm text-warm-text-secondary hover:text-warm-text inline-flex items-center gap-1">
        <ArrowLeft className="h-3.5 w-3.5" /> All tables
      </Link>
      <PageHeader
        title={table.name}
        description="Workspace table"
      >
        {table.sourceType === 'google_sheet' && (
          <Button
            variant="secondary"
            onClick={() => syncSheet.mutate(table.id, {
              onSuccess: () => toast({ title: 'Sync started' }),
              onError: (e: any) => toast({ title: 'Sync failed', description: e.message, variant: 'error' }),
            })}
            disabled={syncSheet.isPending}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Sync now
          </Button>
        )}
        {table.sourceType !== 'google_sheet' && (
          <Button onClick={() => setInsertOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add row
          </Button>
        )}
      </PageHeader>


      {issues.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-amber-900">{issues.length} sync issue{issues.length === 1 ? '' : 's'}</p>
                <p className="text-sm text-amber-800">
                  The most recent sync of this table from Google Sheets had problems. Open them to resolve.
                </p>
              </div>
              <Button variant="secondary" onClick={() => setIssuesOpen(true)}>Resolve</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm font-semibold text-warm-text hover:text-brand"
          onClick={() => setColumnsOpen(o => !o)}
          aria-expanded={columnsOpen}
        >
          {columnsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          Columns
          <span className="text-xs font-normal text-warm-text-secondary">({(table.columns || []).length})</span>
        </button>
        {columnsOpen && (
          <div className="flex gap-2">
            <SuggestColumnDescriptionsButton tableId={table.id} columns={table.columns || []} />
            <Button variant="secondary" size="sm" onClick={() => setAddColOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add column
            </Button>
          </div>
        )}
      </div>
      {columnsOpen && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(table.columns || []).map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono align-top w-48">{c.name}</TableCell>
                    <TableCell className="align-top w-32"><Badge variant="secondary">{TYPE_LABELS[c.type] || c.type}</Badge></TableCell>
                    <TableCell className="align-top">
                      <ColumnDescriptionEditor
                        tableId={table.id}
                        column={c.name}
                        value={c.description || ''}
                      />
                    </TableCell>
                    <TableCell className="text-right align-top w-12">
                      {!['id', 'created_at', 'updated_at'].includes(c.name) && (
                        <DropColumnButton tableId={table.id} column={c.name} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <h3 className="text-sm font-semibold text-warm-text">Rows ({rowsData?.total ?? 0})</h3>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {(table.columns || []).map((c) => <TableHead key={c.name}>{c.name}</TableHead>)}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rowsData?.rows || []).map((row, idx) => (
                <RowEditor key={row.id ?? idx} row={row} tableId={table.id} columns={table.columns || []} readOnly={table.sourceType === 'google_sheet'} />
              ))}
              {(rowsData?.rows || []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={(table.columns || []).length + 1} className="text-center text-warm-text-secondary py-6">
                    No rows yet. Add a row or import data to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddColumnDialog
        open={addColOpen} onClose={() => setAddColOpen(false)} tableId={table.id}
      />
      <SyncIssuesDialog
        open={issuesOpen} onClose={() => setIssuesOpen(false)}
        tableId={table.id}
        issues={issues}
        existingColumns={(table.columns || []).map(c => c.name)}
      />
      <InsertRowDialog
        open={insertOpen} onClose={() => setInsertOpen(false)}
        tableId={table.id} columns={table.columns || []}
      />
    </div>
  );
}

function DropColumnButton({ tableId, column }: { tableId: string; column: string }) {
  const op = useColumnOp();
  return (
    <Button
      variant="ghost" size="sm"
      onClick={() => {
        if (confirm(`Drop column "${column}"? This deletes all values in it.`)) {
          op.mutate({ id: tableId, op: 'drop', column, confirm: true }, {
            onSuccess: () => toast({ title: 'Column dropped' }),
            onError: (e: any) => toast({ title: 'Could not drop column', description: e.message, variant: 'error' }),
          });
        }
      }}
    >
      <Trash2 className="h-3.5 w-3.5 text-warm-text-secondary" />
    </Button>
  );
}

function AddColumnDialog({ open, onClose, tableId }: { open: boolean; onClose: () => void; tableId: string }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseColumnType>('text');
  const [description, setDescription] = useState('');
  const op = useColumnOp();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add column</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="column_name" /></div>
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DatabaseColumnType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this column hold? Helps agents understand when to use it."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            if (!name.trim()) return;
            op.mutate({
              id: tableId, op: 'add',
              column: name.trim().toLowerCase().replace(/\s+/g, '_'),
              type,
              description: description.trim() || undefined,
            }, {
              onSuccess: () => { toast({ title: 'Column added' }); onClose(); setName(''); setDescription(''); },
              onError: (e: any) => toast({ title: 'Could not add column', description: e.message, variant: 'error' }),
            });
          }}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Inline editor for a single column's description. Saves on blur with a
// 700ms debounce so admins can type freely. The description is what gets
// surfaced to agents at runtime alongside the column name + type.
function ColumnDescriptionEditor({ tableId, column, value }: { tableId: string; column: string; value: string }) {
  const [draft, setDraft] = useState(value);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const update = useUpdateColumnDescription();

  // Reset draft when the row's stored value changes (e.g., after a parent refresh).
  useEffect(() => { setDraft(value); }, [value]);

  const persist = (next: string) => {
    if (next === value) return;
    setSavingState('saving');
    update.mutate({ id: tableId, column, description: next }, {
      onSuccess: () => {
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 1200);
      },
      onError: (e: any) => {
        setSavingState('idle');
        toast({ title: 'Could not save description', description: e.message, variant: 'error' });
      },
    });
  };

  return (
    <div className="space-y-1">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => persist(draft)}
        placeholder="What does this column hold?"
        rows={2}
        className="text-sm"
      />
      {savingState === 'saving' && <p className="text-xs text-warm-text-secondary">Saving…</p>}
      {savingState === 'saved' && <p className="text-xs text-emerald-600">Saved</p>}
    </div>
  );
}

function SyncIssuesDialog({
  open, onClose, tableId, issues, existingColumns,
}: {
  open: boolean; onClose: () => void; tableId: string;
  issues: { kind: string; column?: string; message?: string }[];
  existingColumns: string[];
}) {
  const ignore = useIgnoreColumn();
  const mapCol = useMapColumn();
  const addCol = useColumnOp();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sync issues</DialogTitle>
          <DialogDescription>Resolve each problem so the next sync runs cleanly.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {issues.map((iss, idx) => (
            <Card key={idx}>
              <CardContent className="p-3 space-y-2">
                <p className="text-sm">
                  <Badge variant="secondary" className="mr-2">{iss.kind.replace(/_/g, ' ')}</Badge>
                  {iss.column && <span className="font-mono">{iss.column}</span>}
                  {iss.message && <span className="text-warm-text-secondary"> — {iss.message}</span>}
                </p>
                {iss.kind === 'unmapped_column' && iss.column && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => addCol.mutate({ id: tableId, op: 'add', column: iss.column!, type: 'text' }, {
                        onSuccess: () => toast({ title: 'Column added — next sync will populate it.' }),
                        onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'error' }),
                      })}
                    >Add this column</Button>
                    <RenameMapButton column={iss.column} options={existingColumns} onMap={(to) => {
                      mapCol.mutate({ id: tableId, from: iss.column!, to }, {
                        onSuccess: () => toast({ title: 'Mapping saved' }),
                      });
                    }} />
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => ignore.mutate({ id: tableId, column: iss.column! }, {
                        onSuccess: () => toast({ title: 'Column ignored' }),
                      })}
                    >Ignore this column</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameMapButton({ column, options, onMap }: { column: string; options: string[]; onMap: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(options[0] || '');
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Map to existing column</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Map "{column}" to an existing column</DialogTitle></DialogHeader>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.filter(o => !['id', 'created_at', 'updated_at'].includes(o)).map(o => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { onMap(to); setOpen(false); }}>Save mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RowEditor({ row, tableId, columns, readOnly }: { row: any; tableId: string; columns: { name: string; type: DatabaseColumnType }[]; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, any>>(() => {
    const out: Record<string, any> = {};
    for (const c of columns) {
      if (!['id', 'created_at', 'updated_at'].includes(c.name)) out[c.name] = row[c.name] ?? '';
    }
    return out;
  });
  const update = useUpdateRow();
  const del = useDeleteRow();

  return (
    <TableRow>
      {columns.map((c) => (
        <TableCell key={c.name} className="text-sm">
          {editing && !['id', 'created_at', 'updated_at'].includes(c.name) ? (
            <Input
              value={String(values[c.name] ?? '')}
              onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
              className="h-7"
            />
          ) : (
            <span className="font-mono text-xs">{String(row[c.name] ?? '')}</span>
          )}
        </TableCell>
      ))}
      <TableCell className="text-right whitespace-nowrap">
        {readOnly ? null : editing ? (
          <>
            <Button
              size="sm" variant="ghost"
              onClick={() => update.mutate({ id: tableId, rowId: row.id, values }, {
                onSuccess: () => { toast({ title: 'Row updated' }); setEditing(false); },
              })}
            >Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button
              size="sm" variant="ghost"
              onClick={() => {
                if (confirm('Delete this row?')) {
                  del.mutate({ id: tableId, rowId: row.id });
                }
              }}
            ><Trash2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

function InsertRowDialog({ open, onClose, tableId, columns }: { open: boolean; onClose: () => void; tableId: string; columns: { name: string; type: DatabaseColumnType }[] }) {
  const editable = columns.filter(c => !['id', 'created_at', 'updated_at'].includes(c.name));
  const [values, setValues] = useState<Record<string, any>>({});
  const insert = useInsertRow();
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add row</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {editable.map((c) => (
            <div key={c.name}>
              <Label className="font-mono text-xs">{c.name}</Label>
              <Input
                value={String(values[c.name] ?? '')}
                onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
                placeholder={TYPE_LABELS[c.type] || c.type}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => insert.mutate({ id: tableId, values }, {
            onSuccess: () => { toast({ title: 'Row added' }); onClose(); setValues({}); },
            onError: (e: any) => toast({ title: 'Failed', description: e.message, variant: 'error' }),
          })}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Suggest with AI" button that backfills any column missing a description by
// sampling the table's rows and asking Claude. Existing descriptions are left
// alone (the backend only fills empty ones).
function SuggestColumnDescriptionsButton({ tableId, columns }: { tableId: string; columns: { name: string; description?: string | null }[] }) {
  const suggest = useSuggestColumnDescriptions();
  const userCols = columns.filter(c => !['id', 'created_at', 'updated_at'].includes(c.name));
  const missing = userCols.filter(c => !c.description || !c.description.trim()).length;
  if (missing === 0) return null;
  return (
    <Button
      variant="secondary" size="sm"
      onClick={() => suggest.mutate(tableId, {
        onSuccess: (res) => toast({ title: `Filled ${res.updated} description${res.updated === 1 ? '' : 's'}` }),
        onError: (e: any) => toast({ title: 'AI suggestion failed', description: e.message, variant: 'error' }),
      })}
      disabled={suggest.isPending}
    >
      {suggest.isPending ? 'Suggesting…' : `Suggest descriptions (${missing})`}
    </Button>
  );
}
