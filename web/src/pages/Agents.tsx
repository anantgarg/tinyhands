import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bot, Plus, Search, MoreVertical, Pause, Play, Trash2, Eye, Settings } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

  const handleToggleStatus = (agent: { id: string; status: string }) => {
    const newStatus = agent.status === 'active' ? 'paused' : 'active';
    updateAgent.mutate(
      { id: agent.id, status: newStatus } as Parameters<typeof updateAgent.mutate>[0],
      {
        onSuccess: () => toast({ title: `Agent ${newStatus}`, variant: 'success' }),
      },
    );
  };

  const handleDelete = (id: string, name: string) => {
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
      </div>

      {/* Agent List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
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
        <div className="space-y-3">
          {filtered.map((agent) => (
            <Card
              key={agent.id}
              className="cursor-pointer transition-colors hover:bg-warm-bg/30"
              onClick={() => navigate(`/agents/${agent.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-2xl shrink-0">{agent.avatar || '🤖'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{agent.name}</h3>
                        <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                          {agent.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-warm-text-secondary line-clamp-1 mb-2">
                        {agent.system_prompt?.split('\n')[0] ?? 'No description'}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-warm-text-secondary">
                        <span>Model: {agent.model}</span>
                        <span>Tools: {agent.tools?.length ?? 0}</span>
                        <span>Channels: {agent.channels?.length ?? 0}</span>
                        {agent.memory_enabled && <Badge variant="default" className="text-[10px] px-1.5 py-0">Memory</Badge>}
                        <span>by {agent.created_by}</span>
                        <span>{formatDistanceToNow(new Date(agent.created_at), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => navigate(`/agents/${agent.id}`)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => navigate(`/agents/${agent.id}`)}>
                        <Settings className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleToggleStatus(agent)}>
                        {agent.status === 'active' ? (
                          <><Pause className="mr-2 h-4 w-4" /> Pause</>
                        ) : (
                          <><Play className="mr-2 h-4 w-4" /> Resume</>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-600"
                        onClick={() => handleDelete(agent.id, agent.name)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
