import { useState } from 'react';
import { FileText, Search, Download } from 'lucide-react';
import { format } from 'date-fns';
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
import { toast } from '@/components/ui/use-toast';

const ACTIONS = [
  'agent_created',
  'agent_updated',
  'agent_deleted',
  'tool_registered',
  'tool_approved',
  'kb_entry_created',
  'kb_entry_approved',
  'role_changed',
  'connection_created',
  'trigger_created',
  'settings_updated',
];

export function AuditLog() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<string>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAuditLog({
    page,
    limit: 50,
    action: action !== 'all' ? action : undefined,
    search: search || undefined,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const handleExport = () => {
    const csv = [
      ['Time', 'Action', 'User', 'Target', 'Details'].join(','),
      ...entries.map((e) =>
        [
          format(new Date(e.createdAt), 'yyyy-MM-dd HH:mm:ss'),
          e.action,
          e.displayName,
          `${e.targetType}:${e.targetName}`,
          JSON.stringify(e.details),
        ].join(','),
      ),
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
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px]" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No audit entries"
          description={search || action !== 'all' ? 'Try adjusting your filters' : 'Actions will be logged as they occur'}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-warm-text-secondary text-xs whitespace-nowrap">
                      {format(new Date(entry.createdAt), 'MMM d, HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.action.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell>{entry.displayName}</TableCell>
                    <TableCell>
                      <span className="text-warm-text-secondary text-xs">{entry.targetType}:</span>{' '}
                      {entry.targetName}
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate text-warm-text-secondary text-xs font-mono">
                      {JSON.stringify(entry.details)}
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
    </div>
  );
}
