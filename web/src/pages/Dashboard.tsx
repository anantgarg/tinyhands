import { useState } from 'react';
import { Activity, DollarSign, Hash, AlertTriangle, Clock, Timer } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useDashboardMetrics,
  usePowerUsers,
  useAgentCreators,
  usePopularAgents,
  useRecentRuns,
  useAgentFleet,
  useRecentActivity,
} from '@/api/dashboard';

// Safe number/date formatting helpers
function fmt$(v: unknown): string { return `$${(Number(v) || 0).toFixed(2)}`; }
function fmtMs(v: unknown): string { const n = Number(v) || 0; return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`; }
function fmtTok(v: unknown): string { const n = Number(v) || 0; return n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(Math.round(n)); }
function fmtPct(v: unknown): string { return `${((Number(v) || 0) * 100).toFixed(1)}%`; }
function fmtDate(v: unknown): string { if (!v) return '\u2014'; try { return new Date(v as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '\u2014'; } }

export function Dashboard() {
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
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-[100px]" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
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
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Top Users</CardTitle></CardHeader>
          <CardContent>
            {powerUsers.isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <div className="space-y-3">
                {(powerUsers.data ?? []).map((u, i) => (
                  <div key={u.userId ?? i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-warm-text-secondary w-5">{i+1}.</span>
                      <span className="text-sm font-medium">{u.displayName || u.userId || 'Unknown'}</span>
                    </div>
                    <span className="text-sm text-warm-text-secondary">{u.runCount || 0} runs</span>
                  </div>
                ))}
                {(powerUsers.data ?? []).length === 0 && <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top Creators</CardTitle></CardHeader>
          <CardContent>
            {creators.isLoading ? (
              <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <div className="space-y-3">
                {(creators.data ?? []).map((c, i) => (
                  <div key={c.userId ?? i} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-warm-text-secondary w-5">{i+1}.</span>
                      <span className="text-sm font-medium">{c.displayName || c.userId || 'Unknown'}</span>
                    </div>
                    <span className="text-sm text-warm-text-secondary">{c.agentCount || 0} agents</span>
                  </div>
                ))}
                {(creators.data ?? []).length === 0 && <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Most Popular Agents */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Most Popular Agents</CardTitle></CardHeader>
        <CardContent>
          {popularAgents.isLoading ? <Skeleton className="h-[200px]" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Runs</TableHead><TableHead>Cost</TableHead></TableRow></TableHeader>
              <TableBody>
                {(popularAgents.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><div className="flex items-center gap-2"><span>{a.avatar || '\uD83E\uDD16'}</span><span className="font-medium">{a.name || 'Unknown'}</span></div></TableCell>
                    <TableCell>{a.runCount || 0}</TableCell>
                    <TableCell>{fmt$(a.totalCost)}</TableCell>
                  </TableRow>
                ))}
                {(popularAgents.data ?? []).length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-warm-text-secondary">No data yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Agent Fleet */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Agent Fleet</CardTitle></CardHeader>
        <CardContent>
          {fleet.isLoading ? <Skeleton className="h-[200px]" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Agent</TableHead><TableHead>Status</TableHead><TableHead>Model</TableHead><TableHead>Tools</TableHead></TableRow></TableHeader>
              <TableBody>
                {(fleet.data ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell><div className="flex items-center gap-2"><span>{a.avatar || '\uD83E\uDD16'}</span><span className="font-medium">{a.name || 'Unknown'}</span></div></TableCell>
                    <TableCell><Badge variant={a.status === 'active' ? 'success' : 'secondary'}>{a.status || 'unknown'}</Badge></TableCell>
                    <TableCell className="text-warm-text-secondary">{a.model || '\u2014'}</TableCell>
                    <TableCell>{a.toolsCount ?? 0}</TableCell>
                  </TableRow>
                ))}
                {(fleet.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-warm-text-secondary">No agents yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Recent Runs</CardTitle></CardHeader>
        <CardContent>
          {recentRuns.isLoading ? <Skeleton className="h-[200px]" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Trace</TableHead><TableHead>Status</TableHead><TableHead>Model</TableHead><TableHead>Duration</TableHead><TableHead>Cost</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {(recentRuns.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{(r.traceId || '\u2014').slice(0, 8)}</TableCell>
                    <TableCell><Badge variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'secondary'}>{r.status}</Badge></TableCell>
                    <TableCell className="text-warm-text-secondary">{r.model || '\u2014'}</TableCell>
                    <TableCell>{fmtMs(r.durationMs)}</TableCell>
                    <TableCell>{fmt$(r.cost)}</TableCell>
                    <TableCell className="text-warm-text-secondary">{fmtDate(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {(recentRuns.data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-warm-text-secondary">No runs yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {recentActivity.isLoading ? <Skeleton className="h-[200px]" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Actor</TableHead><TableHead>Details</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
              <TableBody>
                {(recentActivity.data ?? []).map((e) => (
                  <TableRow key={e.id}>
                    <TableCell><Badge variant="secondary">{e.action || '\u2014'}</Badge></TableCell>
                    <TableCell>{e.displayName || e.userId || '\u2014'}</TableCell>
                    <TableCell className="text-warm-text-secondary">{e.details || '\u2014'}</TableCell>
                    <TableCell className="text-warm-text-secondary">{fmtDate(e.createdAt)}</TableCell>
                  </TableRow>
                ))}
                {(recentActivity.data ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-warm-text-secondary">No activity yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
