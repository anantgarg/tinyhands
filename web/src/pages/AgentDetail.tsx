import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Pause, Play, MoreVertical, Trash2, Plus, X } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  useAgent,
  useUpdateAgent,
  useAgentVersions,
  useAgentRuns,
  useAgentMemories,
  useAddMemory,
  useDeleteMemory,
  useClearMemories,
  useAgentRoles,
  useSetAgentRole,
  useRemoveAgentRole,
  useUpdateAgentAccess,
  useUpgradeRequests,
  useApproveUpgrade,
  useDenyUpgrade,
} from '@/api/agents';
import { useTriggers } from '@/api/triggers';
import { toast } from '@/components/ui/use-toast';

interface AgentData {
  id: string;
  name: string;
  avatar: string;
  system_prompt: string;
  model: string;
  tools: string[];
  channels: string[];
  memory_enabled: boolean;
  status: string;
  max_turns: number;
  respond_to: string;
  default_access: string;
  write_policy: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: agent, isLoading } = useAgent(id!);
  const updateAgent = useUpdateAgent();
  const [activeTab, setActiveTab] = useState('config');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="text-center py-20">
        <p className="text-warm-text-secondary">Agent not found</p>
        <Button asChild className="mt-4">
          <Link to="/agents">Back to Agents</Link>
        </Button>
      </div>
    );
  }

  const handleToggleStatus = () => {
    const newStatus = agent.status === 'active' ? 'paused' : 'active';
    updateAgent.mutate(
      { id: agent.id, status: newStatus } as Parameters<typeof updateAgent.mutate>[0],
      { onSuccess: () => toast({ title: `Agent ${newStatus}`, variant: 'success' }) },
    );
  };

  return (
    <div>
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{agent.avatar || '🤖'}</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{agent.name}</h1>
              <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                {agent.status}
              </Badge>
            </div>
            <p className="text-sm text-warm-text-secondary">{agent.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleToggleStatus}>
            {agent.status === 'active' ? (
              <><Pause className="mr-2 h-4 w-4" /> Pause</>
            ) : (
              <><Play className="mr-2 h-4 w-4" /> Resume</>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <ConfigTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab agentId={id!} />
        </TabsContent>
        <TabsContent value="memory">
          <MemoryTab agentId={id!} />
        </TabsContent>
        <TabsContent value="triggers">
          <TriggersTab agentId={id!} />
        </TabsContent>
        <TabsContent value="access">
          <AccessTab agentId={id!} agent={agent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const { data: versions, isLoading: versionsLoading } = useAgentVersions(agentId);
  const [showVersions, setShowVersions] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Prompt</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-sm bg-warm-sidebar rounded-btn p-4 font-mono">
            {agent.system_prompt ?? ''}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Version History</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setShowVersions(!showVersions)}>
            {showVersions ? 'Hide' : 'Show'} Versions
          </Button>
        </CardHeader>
        {showVersions && (
          <CardContent>
            {versionsLoading ? (
              <Skeleton className="h-[100px]" />
            ) : (
              <div className="space-y-3">
                {(versions ?? []).map((v) => (
                  <div key={v.version} className="flex items-start justify-between border-b border-warm-border pb-3 last:border-0">
                    <div>
                      <p className="text-sm font-medium">Version {v.version}</p>
                      <p className="text-xs text-warm-text-secondary">
                        by {v.changed_by} - {format(new Date(v.changed_at), 'MMM d, yyyy HH:mm')}
                      </p>
                      <p className="text-xs text-warm-text-secondary mt-1">Model: {v.model}</p>
                    </div>
                  </div>
                ))}
                {(versions ?? []).length === 0 && (
                  <p className="text-sm text-warm-text-secondary">No version history</p>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-warm-text-secondary">Model</Label>
              <p className="text-sm mt-1">{agent.model}</p>
            </div>
            <div>
              <Label className="text-warm-text-secondary">Max Turns</Label>
              <p className="text-sm mt-1">{agent.max_turns}</p>
            </div>
            <div>
              <Label className="text-warm-text-secondary">Respond To</Label>
              <p className="text-sm mt-1">{agent.respond_to}</p>
            </div>
            <div>
              <Label className="text-warm-text-secondary">Memory</Label>
              <p className="text-sm mt-1">{agent.memory_enabled ? 'Enabled' : 'Disabled'}</p>
            </div>
            <div className="col-span-2">
              <Label className="text-warm-text-secondary">Channels</Label>
              <div className="flex flex-wrap gap-1 mt-1">
                {(agent.channels ?? []).map((ch) => (
                  <Badge key={ch} variant="secondary">{ch}</Badge>
                ))}
                {(agent.channels ?? []).length === 0 && (
                  <p className="text-sm text-warm-text-secondary">No channels</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(agent.tools ?? []).map((tool) => (
              <Badge key={tool} variant="default">{tool}</Badge>
            ))}
            {(agent.tools ?? []).length === 0 && (
              <p className="text-sm text-warm-text-secondary">No tools configured</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RunsTab({ agentId }: { agentId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAgentRuns(agentId, { page, limit: 20 });

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trace ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="font-mono text-xs">{run.trace_id?.slice(0, 12)}</TableCell>
                <TableCell>{run.user_id}</TableCell>
                <TableCell>
                  <Badge variant={run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'secondary'}>
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-warm-text-secondary">{run.model}</TableCell>
                <TableCell>{formatDuration(run.duration_ms)}</TableCell>
                <TableCell>{formatCost(run.cost)}</TableCell>
                <TableCell className="text-warm-text-secondary">
                  {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                </TableCell>
              </TableRow>
            ))}
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-warm-text-secondary">
                  No runs yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-warm-text-secondary">{total} total runs</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-warm-text-secondary">
                Page {page} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MemoryTab({ agentId }: { agentId: string }) {
  const { data: memories, isLoading } = useAgentMemories(agentId);
  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();
  const clearMemories = useClearMemories();
  const [showAdd, setShowAdd] = useState(false);
  const [newFact, setNewFact] = useState('');
  const [newCategory, setNewCategory] = useState('general');

  const handleAdd = () => {
    if (!newFact.trim()) return;
    addMemory.mutate(
      { agentId, fact: newFact, category: newCategory },
      {
        onSuccess: () => {
          setNewFact('');
          setShowAdd(false);
          toast({ title: 'Memory added', variant: 'success' });
        },
      },
    );
  };

  const handleClear = () => {
    if (confirm('Clear all memories? This cannot be undone.')) {
      clearMemories.mutate(agentId, {
        onSuccess: () => toast({ title: 'All memories cleared', variant: 'success' }),
      });
    }
  };

  if (isLoading) return <Skeleton className="h-[300px]" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Memory
        </Button>
        <Button variant="danger" size="sm" onClick={handleClear} disabled={!memories?.length}>
          Clear All
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fact</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Relevance</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(memories ?? []).map((mem) => (
                <TableRow key={mem.id}>
                  <TableCell className="max-w-[400px]">{mem.fact}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{mem.category}</Badge>
                  </TableCell>
                  <TableCell>{mem.relevance.toFixed(2)}</TableCell>
                  <TableCell className="text-warm-text-secondary">
                    {formatDistanceToNow(new Date(mem.created_at), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => deleteMemory.mutate({ agentId, memoryId: mem.id })}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(memories ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-warm-text-secondary">
                    No memories stored
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Memory</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Fact</Label>
              <Input
                value={newFact}
                onChange={(e) => setNewFact(e.target.value)}
                placeholder="Enter a fact to remember..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['general', 'customer_preference', 'decision', 'context', 'technical', 'preference', 'procedure', 'correction', 'entity'].map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={addMemory.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TriggersTab({ agentId }: { agentId: string }) {
  const { data: allTriggers, isLoading } = useTriggers();

  if (isLoading) return <Skeleton className="h-[200px]" />;

  const triggers = (allTriggers ?? []).filter((t) => t.agentId === agentId);

  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Config</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Triggered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {triggers.map((trigger) => (
              <TableRow key={trigger.id}>
                <TableCell>
                  <Badge variant="default">{trigger.type}</Badge>
                </TableCell>
                <TableCell className="max-w-[300px] truncate text-warm-text-secondary font-mono text-xs">
                  {JSON.stringify(trigger.config)}
                </TableCell>
                <TableCell>
                  <Badge variant={trigger.enabled ? 'success' : 'secondary'}>
                    {trigger.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </TableCell>
                <TableCell className="text-warm-text-secondary">
                  {trigger.lastTriggeredAt
                    ? formatDistanceToNow(new Date(trigger.lastTriggeredAt), { addSuffix: true })
                    : 'Never'}
                </TableCell>
              </TableRow>
            ))}
            {triggers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-warm-text-secondary">
                  No triggers configured
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AccessTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const { data: roles, isLoading: rolesLoading } = useAgentRoles(agentId);
  const { data: upgradeRequests } = useUpgradeRequests(agentId);
  const setRole = useSetAgentRole();
  const removeRole = useRemoveAgentRole();
  const updateAccess = useUpdateAgentAccess();
  const approveUpgrade = useApproveUpgrade();
  const denyUpgrade = useDenyUpgrade();

  const [defaultAccess, setDefaultAccess] = useState(agent.default_access ?? 'viewer');
  const [writePolicy, setWritePolicy] = useState(agent.write_policy ?? 'allow');

  const handleSaveAccess = () => {
    updateAccess.mutate(
      { agentId, default_access: defaultAccess, write_policy: writePolicy },
      { onSuccess: () => toast({ title: 'Access settings updated', variant: 'success' }) },
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Default Access</Label>
              <Select value={defaultAccess} onValueChange={setDefaultAccess}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Write Policy</Label>
              <Select value={writePolicy} onValueChange={setWritePolicy}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="confirm">Confirm</SelectItem>
                  <SelectItem value="admin_confirm">Admin Confirm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" onClick={handleSaveAccess} disabled={updateAccess.isPending}>
            Save Access Settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roles</CardTitle>
        </CardHeader>
        <CardContent>
          {rolesLoading ? (
            <Skeleton className="h-[100px]" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles ?? []).map((role) => (
                  <TableRow key={role.user_id}>
                    <TableCell>{role.display_name}</TableCell>
                    <TableCell>
                      <Select
                        value={role.role}
                        onValueChange={(newRole) =>
                          setRole.mutate({ agentId, userId: role.user_id, role: newRole })
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Owner</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeRole.mutate({ agentId, userId: role.user_id })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(roles ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-warm-text-secondary">
                      No roles assigned
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(upgradeRequests ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upgrade Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="w-32"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(upgradeRequests ?? []).map((req) => (
                  <TableRow key={req.id}>
                    <TableCell>{req.display_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{req.reason}</TableCell>
                    <TableCell>
                      <Badge variant={req.status === 'pending' ? 'warning' : req.status === 'approved' ? 'success' : 'danger'}>
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary">
                      {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {req.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            onClick={() => approveUpgrade.mutate({ agentId, requestId: req.id })}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => denyUpgrade.mutate({ agentId, requestId: req.id })}
                          >
                            Deny
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
