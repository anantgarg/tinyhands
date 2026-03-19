import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bot, Plus, Search, MoreVertical, Pause, Play, Trash2, Pencil } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgents, useDeleteAgent, useUpdateAgent } from '@/api/agents';
import { toast } from '@/components/ui/use-toast';

export function Agents() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [creatorFilter, setCreatorFilter] = useState<string>('all');
  const { data: agents, isLoading } = useAgents();
  const deleteAgent = useDeleteAgent();
  const updateAgent = useUpdateAgent();

  const filtered = (agents ?? []).filter((agent) => {
    if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && agent.status !== statusFilter) return false;
    if (modelFilter !== 'all' && agent.model !== modelFilter) return false;
    if (creatorFilter !== 'all' && agent.createdBy !== creatorFilter) return false;
    return true;
  });

  const models = [...new Set((agents ?? []).map((a) => a.model))];
  const creators = [...new Set((agents ?? []).map((a) => a.createdBy).filter(Boolean))];

  const handleToggleStatus = (e: React.MouseEvent, agent: { id: string; status: string }) => {
    e.stopPropagation();
    const newStatus = agent.status === 'active' ? 'paused' : 'active';
    updateAgent.mutate(
      { id: agent.id, status: newStatus },
      {
        onSuccess: () => toast({ title: `Agent ${newStatus}`, variant: 'success' }),
      },
    );
  };

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Delete agent "${name}"? This cannot be undone.`)) {
      deleteAgent.mutate(id, {
        onSuccess: () => toast({ title: 'Agent deleted', variant: 'success' }),
      });
    }
  };

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
        <Select value={creatorFilter} onValueChange={setCreatorFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Creator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Creators</SelectItem>
            {creators.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Agent Table */}
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
          description={search || statusFilter !== 'all' || modelFilter !== 'all' || creatorFilter !== 'all' ? 'Try adjusting your filters' : 'Create your first agent to get started'}
          action={!search && statusFilter === 'all' && modelFilter === 'all' && creatorFilter === 'all' ? { label: 'Create Agent', onClick: () => navigate('/agents/new') } : undefined}
        />
      ) : (
        <div className="rounded-card border border-warm-border bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((agent) => (
                <TableRow
                  key={agent.id}
                  className="cursor-pointer hover:bg-warm-bg/30"
                  onClick={() => navigate(`/agents/${agent.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg shrink-0">{agent.avatarEmoji || '🤖'}</span>
                      <span className="font-medium">{agent.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                      {agent.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {agent.model}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {agent.channelIds?.length ?? 0}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {agent.tools?.length ?? 0}
                  </TableCell>
                  <TableCell>
                    <Badge variant={agent.memoryEnabled ? 'default' : 'secondary'}>
                      {agent.memoryEnabled ? 'On' : 'Off'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {agent.createdBy}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => navigate(`/agents/${agent.id}`)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleToggleStatus(e, agent)}>
                          {agent.status === 'active' ? (
                            <><Pause className="mr-2 h-4 w-4" /> Pause</>
                          ) : (
                            <><Play className="mr-2 h-4 w-4" /> Resume</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={(e) => handleDelete(e, agent.id, agent.name)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
