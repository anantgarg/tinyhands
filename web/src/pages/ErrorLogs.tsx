import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useErrorLog } from '@/api/observability';
import { useAgents } from '@/api/agents';
import { renderEmoji } from '@/lib/emoji';

function formatDuration(ms: unknown): string {
  const n = Number(ms) || 0;
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}

function fmtUser(displayName: unknown, userId: unknown): string {
  if (displayName && typeof displayName === 'string' && displayName.trim()) return displayName;
  return '\u2014';
}

export function ErrorLogs() {
  const [days, setDays] = useState('7');
  const [agentId, setAgentId] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: entries, isLoading, isError } = useErrorLog({
    days: parseInt(days, 10),
    agentId: agentId !== 'all' ? agentId : undefined,
  });
  const { data: agents } = useAgents();

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div>
      <PageHeader title="Error Logs" description="Failed runs and error details" />

      <div className="flex items-center gap-3 mb-6">
        <Select value={days} onValueChange={(v) => setDays(v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>

        <Select value={agentId} onValueChange={(v) => setAgentId(v)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.avatarEmoji ? `${renderEmoji(a.avatarEmoji)} ` : ''}{a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-[400px]" />
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertTriangle className="h-5 w-5 mx-auto mb-2" />
            Failed to load error logs
          </CardContent>
        </Card>
      ) : (entries ?? []).length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No errors in this period"
          description="All runs completed successfully. Keep up the great work!"
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries ?? []).map((entry) => (
                  <>
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer hover:bg-warm-bg/50"
                      onClick={() => toggleExpand(entry.id)}
                    >
                      <TableCell className="pr-0">
                        {expandedId === entry.id ? (
                          <ChevronDown className="h-4 w-4 text-warm-text-secondary" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-warm-text-secondary" />
                        )}
                      </TableCell>
                      <TableCell className="text-warm-text-secondary text-xs whitespace-nowrap">
                        {fmtRelative(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {entry.avatarEmoji && <span>{renderEmoji(entry.avatarEmoji)}</span>}
                          <span className="text-sm font-medium">{entry.agentName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {fmtUser(entry.displayName, entry.slackUserId)}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-sm text-red-600">
                        {entry.output || '\u2014'}
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">
                        {formatDuration(entry.durationMs)}
                      </TableCell>
                    </TableRow>
                    {expandedId === entry.id && (
                      <TableRow key={`${entry.id}-detail`}>
                        <TableCell colSpan={6} className="bg-red-50/50 border-l-2 border-red-300">
                          <div className="py-3 px-2 space-y-3">
                            <div>
                              <p className="text-xs font-semibold text-warm-text-secondary mb-1">Error Details</p>
                              <pre className="text-sm whitespace-pre-wrap font-mono bg-white rounded-md p-3 border border-red-200 max-h-[200px] overflow-y-auto">
                                {entry.output || 'No error details available'}
                              </pre>
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-warm-text-secondary">
                              <span>Model: <Badge variant="secondary">{entry.model}</Badge></span>
                              <span>Tokens: {entry.inputTokens?.toLocaleString() ?? 0} in / {entry.outputTokens?.toLocaleString() ?? 0} out</span>
                              <span>Cost: ${(Number(entry.estimatedCostUsd) || 0).toFixed(4)}</span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
