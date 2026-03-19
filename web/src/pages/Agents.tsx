import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bot, Plus, Search, MoreVertical, Pause, Play, Trash2, Eye, Settings } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgents, useDeleteAgent, useUpdateAgent } from '@/api/agents';
import type { Agent } from '@/api/agents';
import { useAuthStore } from '@/store/auth';
import { renderEmoji } from '@/lib/emoji';
import { toast } from '@/components/ui/use-toast';

export function Agents() {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const { data: agents, isLoading } = useAgents();
  const deleteAgent = useDeleteAgent();
  const updateAgent = useUpdateAgent();

  const filtered = (agents ?? []).filter((agent) => {
    if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && agent.status !== statusFilter) return false;
    if (modelFilter !== 'all' && agent.model !== modelFilter) return false;
    return true;
  });

  const models = [...new Set((agents ?? []).map((a) => a.model))];

  const yourAgents = filtered.filter(
    (a) => a.createdBy === currentUserId,
  );
  const allAgents = filtered.filter(
    (a) => a.createdBy !== currentUserId,
  );

  const handleToggleStatus = (agent: { id: string; status: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = agent.status === 'active' ? 'paused' : 'active';
    updateAgent.mutate(
      { id: agent.id, status: newStatus } as Parameters<typeof updateAgent.mutate>[0],
      {
        onSuccess: () => toast({ title: `Agent ${newStatus}`, variant: 'success' }),
      },
    );
  };

  const handleDelete = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete agent "${name}"? This cannot be undone.`)) {
      deleteAgent.mutate(id, {
        onSuccess: () => toast({ title: 'Agent deleted', variant: 'success' }),
      });
    }
  };

  function formatCreator(agent: Agent): string {
    if (agent.createdBy === currentUserId) return 'You';
    if (agent.createdByDisplayName) return agent.createdByDisplayName;
    return '\u2014';
  }

  function formatModelShort(model: string): string {
    if (model.includes('sonnet')) return 'Sonnet';
    if (model.includes('opus')) return 'Opus';
    if (model.includes('haiku')) return 'Haiku';
    return model;
  }

  function renderAgentTable(agentList: Agent[]) {
    return (
      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead>Memory</TableHead>
              <TableHead>Creator</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agentList.map((agent) => (
              <TableRow
                key={agent.id}
                className="cursor-pointer"
                onClick={() => navigate(`/agents/${agent.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{renderEmoji(agent.avatarEmoji)}</span>
                    <span className="font-medium">{agent.name}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                    {agent.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatModelShort(agent.model)}
                </TableCell>
                <TableCell className="text-sm">{agent.tools?.length ?? 0}</TableCell>
                <TableCell className="text-sm">
                  {agent.memoryEnabled ? 'On' : 'Off'}
                </TableCell>
                <TableCell className="text-sm text-warm-text-secondary">
                  {formatCreator(agent)}
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {agent.createdAt
                    ? formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })
                    : '\u2014'}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/agents/${agent.id}`)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/agents/${agent.id}`)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => handleToggleStatus(agent, e)}>
                        {agent.status === 'active' ? (
                          <><Pause className="mr-2 h-4 w-4" /> Pause</>
                        ) : (
                          <><Play className="mr-2 h-4 w-4" /> Resume</>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={(e) => handleDelete(agent.id, agent.name, e)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {agentList.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-warm-text-secondary py-8">
                  No agents in this section
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Agents" description={`${agents?.length ?? 0} agents`}>
        <Button variant="outline" asChild>
          <Link to="/agents/templates">Templates</Link>
        </Button>
        <Button asChild>
          <Link to="/agents/new">
            <Plus className="mr-2 h-4 w-4" />
            New Agent
          </Link>
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
          <Input
            placeholder="Search agents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
        <Select value={modelFilter} onValueChange={setModelFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {models.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents found"
          description={search || statusFilter !== 'all' || modelFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first agent to get started'}
          action={!search && statusFilter === 'all' && modelFilter === 'all' ? { label: 'Create Agent', onClick: () => navigate('/agents/new') } : undefined}
        />
      ) : (
        <div className="space-y-8">
          {/* Your Agents */}
          {yourAgents.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-warm-text-secondary uppercase tracking-wider mb-3">
                Your Agents ({yourAgents.length})
              </h2>
              {renderAgentTable(yourAgents)}
            </section>
          )}

          {/* All Agents */}
          <section>
            <h2 className="text-sm font-semibold text-warm-text-secondary uppercase tracking-wider mb-3">
              {yourAgents.length > 0 ? `Other Agents (${allAgents.length})` : `All Agents (${filtered.length})`}
            </h2>
            {renderAgentTable(yourAgents.length > 0 ? allAgents : filtered)}
          </section>
        </div>
      )}
    </div>
  );
}
