import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, DollarSign, Hash, AlertTriangle, Clock, Timer } from 'lucide-react';
import { format } from 'date-fns';
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

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function Dashboard() {
  const [days, setDays] = useState(7);
  const metrics = useDashboardMetrics(days);
  const powerUsers = usePowerUsers(days);
  const creators = useAgentCreators();
  const popularAgents = usePopularAgents(days);
  const recentRuns = useRecentRuns();
  const fleet = useAgentFleet();
  const recentActivity = useRecentActivity();

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
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Runs" value={metrics.data?.totalRuns ?? 0} icon={Activity} color="blue" />
            <StatCard label="Total Cost" value={formatCost(metrics.data?.totalCostUsd ?? 0)} icon={DollarSign} color="green" />
            <StatCard label="Total Tokens" value={formatTokens(metrics.data?.totalTokens ?? 0)} icon={Hash} color="amber" />
            <StatCard
              label="Error Rate"
              value={`${((metrics.data?.errorRate ?? 0) * 100).toFixed(1)}%`}
              icon={AlertTriangle}
              color="red"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard
              label="Performance (avg / p50 / p95)"
              value={`${formatDuration(metrics.data?.avgDurationMs ?? 0)} / ${formatDuration(metrics.data?.p50DurationMs ?? 0)} / ${formatDuration(metrics.data?.p95DurationMs ?? 0)}`}
              icon={Clock}
              color="blue"
            />
            <StatCard
              label="Queue Wait (p50 / p95)"
              value={`${formatDuration(metrics.data?.queueWaitP50Ms ?? 0)} / ${formatDuration(metrics.data?.queueWaitP95Ms ?? 0)}`}
              icon={Timer}
              color="amber"
            />
          </div>
        </>
      )}

      {/* Runs Over Time Chart */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Runs Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.isLoading ? (
            <Skeleton className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={metrics.data?.runsByDay ?? []}>
                <defs>
                  <linearGradient id="colorRuns" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1E8B5E" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1E8B5E" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0DED9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: '#787774' }}
                  tickFormatter={(d) => format(new Date(d), 'MMM d')}
                />
                <YAxis tick={{ fontSize: 12, fill: '#787774' }} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid #E0DED9',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#1E8B5E"
                  strokeWidth={2}
                  fill="url(#colorRuns)"
                  name="Runs"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Top Users + Top Creators */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Users</CardTitle>
          </CardHeader>
          <CardContent>
            {powerUsers.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(powerUsers.data ?? []).map((user, i) => (
                  <div key={user.userId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-warm-text-secondary w-5">{i + 1}.</span>
                      <span className="text-sm font-medium">{user.displayName}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-warm-text-secondary">{user.runCount} runs</span>
                      <span className="text-sm font-medium">{formatCost(user.totalCost)}</span>
                    </div>
                  </div>
                ))}
                {(powerUsers.data ?? []).length === 0 && (
                  <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Creators</CardTitle>
          </CardHeader>
          <CardContent>
            {creators.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(creators.data ?? []).map((creator, i) => (
                  <div key={creator.userId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-warm-text-secondary w-5">{i + 1}.</span>
                      <span className="text-sm font-medium">{creator.displayName}</span>
                    </div>
                    <span className="text-sm text-warm-text-secondary">{creator.agentCount} agents</span>
                  </div>
                ))}
                {(creators.data ?? []).length === 0 && (
                  <p className="text-sm text-warm-text-secondary text-center py-4">No data yet</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Most Popular Agents */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Most Popular Agents</CardTitle>
        </CardHeader>
        <CardContent>
          {popularAgents.isLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Runs</TableHead>
                  <TableHead>Total Cost</TableHead>
                  <TableHead>Avg Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(popularAgents.data ?? []).map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{agent.avatar}</span>
                        <span className="font-medium">{agent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{agent.runCount}</TableCell>
                    <TableCell>{formatCost(agent.totalCost)}</TableCell>
                    <TableCell>{formatDuration(agent.avgDuration)}</TableCell>
                  </TableRow>
                ))}
                {(popularAgents.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-warm-text-secondary">
                      No data yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Agent Fleet */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Agent Fleet</CardTitle>
        </CardHeader>
        <CardContent>
          {fleet.isLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Tools</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Total Runs</TableHead>
                  <TableHead>Last Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(fleet.data ?? []).map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{agent.avatar}</span>
                        <span className="font-medium">{agent.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary">{agent.model}</TableCell>
                    <TableCell>{agent.toolsCount}</TableCell>
                    <TableCell>{agent.channelsCount}</TableCell>
                    <TableCell>{agent.totalRuns}</TableCell>
                    <TableCell className="text-warm-text-secondary">
                      {agent.lastRunAt ? format(new Date(agent.lastRunAt), 'MMM d, HH:mm') : 'Never'}
                    </TableCell>
                  </TableRow>
                ))}
                {(fleet.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-warm-text-secondary">
                      No agents created yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Recent Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns.isLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentRuns.data ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{run.agentAvatar}</span>
                        <span className="font-medium">{run.agentName}</span>
                      </div>
                    </TableCell>
                    <TableCell>{run.displayName}</TableCell>
                    <TableCell>
                      <Badge variant={run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'secondary'}>
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary">{run.model}</TableCell>
                    <TableCell>{formatDuration(run.durationMs)}</TableCell>
                    <TableCell>{formatCost(run.cost)}</TableCell>
                    <TableCell className="text-warm-text-secondary">
                      {format(new Date(run.createdAt), 'MMM d, HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
                {(recentRuns.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-warm-text-secondary">
                      No runs yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.isLoading ? (
            <Skeleton className="h-[200px]" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentActivity.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Badge variant="secondary">{entry.action}</Badge>
                    </TableCell>
                    <TableCell>{entry.displayName}</TableCell>
                    <TableCell className="max-w-[300px] truncate text-warm-text-secondary">
                      {entry.details}
                    </TableCell>
                    <TableCell className="text-warm-text-secondary">
                      {format(new Date(entry.createdAt), 'MMM d, HH:mm')}
                    </TableCell>
                  </TableRow>
                ))}
                {(recentActivity.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-warm-text-secondary">
                      No activity yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
