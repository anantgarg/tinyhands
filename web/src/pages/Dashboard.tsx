import { useState } from 'react';
import { Activity, DollarSign, Hash, AlertTriangle, Clock, Timer, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useDashboardMetrics,
  usePowerUsers,
  useAgentCreators,
  usePopularAgents,
  useRecentRuns,
  useAgentFleet,
  useRecentActivity,
} from '@/api/dashboard';
import { renderEmoji } from '@/lib/emoji';
import { useAuthStore } from '@/store/auth';

// Safe number/date formatting helpers
function fmt$(v: unknown): string { return `$${(Number(v) || 0).toFixed(2)}`; }
function fmtMs(v: unknown): string { const n = Number(v) || 0; return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`; }
function fmtTok(v: unknown): string { const n = Number(v) || 0; return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(Math.round(n)); }
function fmtPct(v: unknown): string { return `${((Number(v) || 0) * 100).toFixed(1)}%`; }
function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}
function fmtUserId(displayName: unknown, _userId?: unknown): string {
  if (displayName && typeof displayName === 'string' && displayName.trim()) return displayName;
  return '\u2014';
}
function humanizeAction(action: unknown): string {
  if (!action || typeof action !== 'string') return '\u2014';
  const map: Record<string, string> = {
    agent_created: 'Agent Created',
    agent_updated: 'Agent Updated',
    agent_deleted: 'Agent Deleted',
    agent_config_change: 'Config Changed',
    tool_registered: 'Tool Registered',
    tool_approved: 'Tool Approved',
    kb_entry_created: 'KB Entry Created',
    kb_entry_approved: 'KB Entry Approved',
    role_change: 'Role Changed',
    role_changed: 'Role Changed',
    connection_created: 'Connection Created',
    trigger_created: 'Trigger Created',
    settings_updated: 'Settings Updated',
  };
  return map[action] || action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Dashboard() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [days, setDays] = useState(7);
  const metrics = useDashboardMetrics(days);
  const powerUsers = usePowerUsers(days);
  const creators = useAgentCreators();
  const popularAgents = usePopularAgents(days);
  const recentRuns = useRecentRuns();
  const fleet = useAgentFleet();
  const recentActivity = useRecentActivity();

  const m = metrics.data;

  return (
    <div>
      <PageHeader title="Dashboard" description="Platform overview and metrics">
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      {/* Stat Cards */}
      {metrics.isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-[100px]" />)}
        </div>
      ) : metrics.isError ? (
        <Card className="mb-6">
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p>Failed to load metrics. Please try refreshing.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Runs" value={m?.totalRuns ?? 0} icon={Activity} color="blue" />
            <StatCard label="Total Cost" value={fmt$(m?.totalCostUsd)} icon={DollarSign} color="green" />
            <StatCard label="Total Tokens" value={fmtTok(m?.totalTokens)} icon={Hash} color="amber" />
            <StatCard label="Error Rate" value={fmtPct(m?.errorRate)} icon={AlertTriangle} color="red" />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard label="Performance (avg / p50 / p95)" value={`${fmtMs(m?.avgDurationMs)} / ${fmtMs(m?.p50DurationMs)} / ${fmtMs(m?.p95DurationMs)}`} icon={Clock} color="blue" />
            <StatCard label="Queue Wait (p50 / p95)" value={`${fmtMs(m?.queueWaitP50Ms)} / ${fmtMs(m?.queueWaitP95Ms)}`} icon={Timer} color="amber" />
          </div>
        </>
      )}

      {/* Top Users + Top Creators */}
      <div className={`grid ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'} gap-4 mb-6`}>
        <Card>
          <CardHeader><CardTitle className="text-base">Top Users</CardTitle></CardHeader>
          <CardContent>
            {powerUsers.isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : powerUsers.isError ? (
              <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
            ) : (
              <div className="space-y-3">
                {(powerUsers.data ?? []).map((u, i) => (
                  <div key={u.userId ?? i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-warm-text-secondary w-5">{i+1}.</span>
                      <span className="text-sm font-medium">{fmtUserId(u.displayName, u.userId)}</span>
                    </div>
                    <span className="text-sm text-warm-text-secondary">{u.runCount || 0} runs</span>
                  </div>
                ))}
                {(powerUsers.data ?? []).length === 0 && <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>}
              </div>
            )}
          </CardContent>
        </Card>
        {isAdmin && (
          <Card>
            <CardHeader><CardTitle className="text-base">Top Creators</CardTitle></CardHeader>
            <CardContent>
              {creators.isLoading ? (
                <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8" />)}</div>
              ) : creators.isError ? (
                <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
              ) : (
                <div className="space-y-3">
                  {(creators.data ?? []).map((c, i) => (
                    <div key={c.userId ?? i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-warm-text-secondary w-5">{i+1}.</span>
                        <span className="text-sm font-medium">{fmtUserId(c.displayName, c.userId)}</span>
                      </div>
                      <span className="text-sm text-warm-text-secondary">{c.agentCount || 0} agents</span>
                    </div>
                  ))}
                  {(creators.data ?? []).length === 0 && <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Most Popular Agents */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Most Popular Agents</CardTitle></CardHeader>
        <CardContent>
          {popularAgents.isLoading ? <Skeleton className="h-[200px]" /> : popularAgents.isError ? (
            <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Runs</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(popularAgents.data ?? []).map((a) => (
                    <TableRow key={a.id}>
                      <TableCell><div className="flex items-center gap-2"><span>{renderEmoji(a.avatar || '🤖')}</span><span className="font-medium">{a.name || 'Unknown'}</span></div></TableCell>
                      <TableCell>{a.runCount || 0}</TableCell>
                      <TableCell>{fmt$(a.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                  {(popularAgents.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-warm-text-secondary">No data yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Fleet (admin only) */}
      {isAdmin && (
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Agent Fleet</CardTitle></CardHeader>
          <CardContent>
            {fleet.isLoading ? <Skeleton className="h-[200px]" /> : fleet.isError ? (
              <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead>Model</TableHead><TableHead>Tools</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(fleet.data ?? []).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell><div className="flex items-center gap-2"><span>{renderEmoji(a.avatar || '🤖')}</span><span className="font-medium">{a.name || 'Unknown'}</span></div></TableCell>
                        <TableCell><Badge variant={a.status === 'active' ? 'success' : 'secondary'}>{a.status || 'unknown'}</Badge></TableCell>
                        <TableCell className="text-warm-text-secondary">{a.model || '\u2014'}</TableCell>
                        <TableCell>{a.toolsCount ?? 0}</TableCell>
                      </TableRow>
                    ))}
                    {(fleet.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-warm-text-secondary">No agents yet</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Runs */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Recent Runs</CardTitle></CardHeader>
        <CardContent>
          {recentRuns.isLoading ? <Skeleton className="h-[200px]" /> : recentRuns.isError ? (
            <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
          ) : (
            <TooltipProvider>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead>Duration</TableHead><TableHead>Cost</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(recentRuns.data ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{renderEmoji(r.agentAvatar || '🤖')}</span>
                          <span className="font-medium">{r.agentName || '\u2014'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.status === 'failed' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="danger" className="cursor-help">{r.status}</Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              <p className="text-xs">{r.error || r.errorMessage || 'No error details available'}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Badge variant={r.status === 'completed' ? 'success' : 'secondary'}>{r.status ?? 'unknown'}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{fmtMs(r.durationMs)}</TableCell>
                      <TableCell>{fmt$(r.cost)}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">{fmtRelative(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {(recentRuns.data ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-warm-text-secondary">No runs yet</TableCell></TableRow>}
                </TableBody>
              </Table>
              </div>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {recentActivity.isLoading ? <Skeleton className="h-[200px]" /> : recentActivity.isError ? (
            <p className="text-sm text-red-500 text-center py-4">Failed to load</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Details</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(recentActivity.data ?? []).map((e) => (
                    <TableRow key={e.id}>
                      <TableCell><Badge variant="secondary">{humanizeAction(e.action)}</Badge></TableCell>
                      <TableCell>{fmtUserId(e.displayName, e.userId)}</TableCell>
                      <TableCell className="text-warm-text-secondary max-w-[250px] truncate">{e.details || '\u2014'}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">{fmtRelative(e.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {(recentActivity.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-warm-text-secondary">No activity yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
