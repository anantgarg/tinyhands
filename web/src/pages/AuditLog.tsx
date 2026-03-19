import { useState } from 'react';
import { FileText, Search, Download, AlertCircle, Shield } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuditLog } from '@/api/audit';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

const ACTION_TYPES = [
  { value: 'agent_created', label: 'Agent Created' },
  { value: 'agent_updated', label: 'Agent Updated' },
  { value: 'agent_deleted', label: 'Agent Deleted' },
  { value: 'agent_config_change', label: 'Config Changed' },
  { value: 'tool_registered', label: 'Tool Registered' },
  { value: 'tool_approved', label: 'Tool Approved' },
  { value: 'kb_entry_created', label: 'KB Entry Created' },
  { value: 'kb_entry_approved', label: 'KB Entry Approved' },
  { value: 'role_changed', label: 'Role Changed' },
  { value: 'connection_created', label: 'Connection Created' },
  { value: 'trigger_created', label: 'Trigger Created' },
  { value: 'settings_updated', label: 'Settings Updated' },
];

function humanizeAction(action: unknown): string {
  if (!action || typeof action !== 'string') return '\u2014';
  const found = ACTION_TYPES.find((a) => a.value === action);
  if (found) return found.label;
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtUserId(displayName: unknown, userId: unknown): string {
  if (displayName && typeof displayName === 'string' && displayName.trim()) return displayName;
  return '\u2014';
}

function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}

function fmtDetails(details: unknown): string {
  if (!details) return '\u2014';
  if (typeof details === 'string') return details;
  try {
    const str = JSON.stringify(details);
    return str === '{}' || str === 'null' ? '\u2014' : str;
  } catch {
    return '\u2014';
  }
}

export function AuditLog() {
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-warm-text-secondary mb-4" />
        <h2 className="text-lg font-bold">Admin Access Required</h2>
        <p className="text-warm-text-secondary mt-2">You need admin permissions to access this page.</p>
      </div>
    );
  }
  return <AuditLogContent />;
}

function AuditLogContent() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<string>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useAuditLog({
    page,
    limit: 50,
    action: action !== 'all' ? action : undefined,
    search: search || undefined,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const handleExport = () => {
    if (entries.length === 0) return;
    const csv = [
      ['Time', 'Action', 'User', 'Target', 'Details'].join(','),
      ...entries.map((e) => {
        const time = e.createdAt ? format(new Date(e.createdAt), 'yyyy-MM-dd HH:mm:ss') : '';
        return [
          time,
          e.action ?? '',
          fmtUserId(e.displayName, e.userId),
          `${e.targetType ?? ''}:${e.targetName ?? ''}`,
          JSON.stringify(e.details ?? ''),
        ].join(',');
      }),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exported', variant: 'success' });
  };

  return (
    <div>
      <PageHeader title="Audit Log" description="Track all actions across the platform">
        <Button variant="outline" onClick={handleExport} disabled={entries.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </PageHeader>

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
          <Input
            placeholder="Search audit log..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {ACTION_TYPES.map((a) => (
              <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px]" />
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load audit log entries
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No audit entries"
          description={search || action !== 'all' ? 'Try adjusting your filters' : 'Actions will be logged as they occur'}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Badge variant="secondary">{humanizeAction(entry.action ?? entry.actionType)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {fmtUserId(entry.displayName, entry.userId ?? entry.actorUserId)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.targetName ?? entry.agentName ?? '\u2014'}
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate text-warm-text-secondary text-xs font-mono">
                      {fmtDetails(entry.details)}
                    </TableCell>
                    <TableCell className="text-warm-text-secondary text-xs whitespace-nowrap">
                      {fmtRelative(entry.createdAt)}
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
    </div>
  );
}
