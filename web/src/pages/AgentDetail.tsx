import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pause, Play, MoreVertical, Trash2, Plus, X,
  Info, Pencil, Check, Loader2, RotateCcw, Eye,
  Webhook, Clock, MessageSquare, Zap,
} from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  useAgent,
  useUpdateAgent,
  useDeleteAgent,
  useAgentVersions,
  useRevertAgent,
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
  useRemoveAgentTool,
  useAddAgentTool,
  useAgentTriggers,
  useAddAgentTrigger,
} from '@/api/agents';
import type { Agent as AgentData, AgentVersion } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { useUpdateTrigger, useDeleteTrigger } from '@/api/triggers';
import { renderEmoji } from '@/lib/emoji';
import { toast } from '@/components/ui/use-toast';

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-warm-text-secondary cursor-help inline-block ml-1" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-sm">{text}</TooltipContent>
    </Tooltip>
  );
}

function activationLabel(agent: AgentData): string {
  if (agent.mentionsOnly) return 'Mentions Only';
  if (agent.respondToAllMessages) return 'All Messages';
  return 'Relevant Messages';
}

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(id!);
  const updateAgent = useUpdateAgent();
  const deleteAgentMut = useDeleteAgent();
  const [activeTab, setActiveTab] = useState('overview');

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
      { id: agent.id, status: newStatus },
      { onSuccess: () => toast({ title: `Agent ${newStatus}`, variant: 'success' }) },
    );
  };

  const handleDelete = () => {
    if (confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) {
      deleteAgentMut.mutate(agent.id, {
        onSuccess: () => {
          toast({ title: 'Agent deleted', variant: 'success' });
          navigate('/agents');
        },
      });
    }
  };

  return (
    <div>
      {/* Back link */}
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{renderEmoji(agent.avatarEmoji)}</span>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold">{agent.name}</h1>
              <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                {agent.status}
              </Badge>
              <Badge variant="secondary">{agent.model}</Badge>
            </div>
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
              <DropdownMenuItem className="text-red-600" onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab agentId={id!} agent={agent} />
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

// ---- Overview Tab ----

function OverviewTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const updateAgent = useUpdateAgent();
  const { data: versions, isLoading: versionsLoading } = useAgentVersions(agentId);
  const revertAgent = useRevertAgent();
  const { data: availableTools } = useAvailableTools();
  const removeAgentTool = useRemoveAgentTool();
  const addAgentTool = useAddAgentTool();

  // Instructions editing
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  // Configuration editing
  const [configDirty, setConfigDirty] = useState(false);
  const [configDraft, setConfigDraft] = useState({
    model: agent.model,
    maxTurns: agent.maxTurns,
    mentionsOnly: agent.mentionsOnly,
    respondToAllMessages: agent.respondToAllMessages,
    memoryEnabled: agent.memoryEnabled,
    selfEvolutionMode: agent.selfEvolutionMode ?? 'off',
    writePolicy: agent.writePolicy ?? 'auto',
    defaultAccess: agent.defaultAccess ?? 'member',
  });

  // Tool dialog
  const [showAddTool, setShowAddTool] = useState(false);
  const [selectedToolsToAdd, setSelectedToolsToAdd] = useState<Set<string>>(new Set());

  // Version preview dialog
  const [previewVersion, setPreviewVersion] = useState<AgentVersion | null>(null);

  const startEditPrompt = () => {
    setPromptDraft(agent.systemPrompt ?? '');
    setEditingPrompt(true);
  };

  const savePrompt = () => {
    updateAgent.mutate(
      { id: agentId, systemPrompt: promptDraft },
      {
        onSuccess: () => {
          setEditingPrompt(false);
          toast({ title: 'Instructions updated', variant: 'success' });
        },
      },
    );
  };

  const updateConfig = (partial: Partial<typeof configDraft>) => {
    setConfigDraft((d) => ({ ...d, ...partial }));
    setConfigDirty(true);
  };

  const saveConfig = () => {
    updateAgent.mutate(
      { id: agentId, ...configDraft },
      {
        onSuccess: () => {
          setConfigDirty(false);
          toast({ title: 'Configuration updated', variant: 'success' });
        },
      },
    );
  };

  const handleRevert = (version: number) => {
    if (confirm(`Revert to version ${version}? The current configuration will be overwritten.`)) {
      revertAgent.mutate(
        { id: agentId, version },
        { onSuccess: () => toast({ title: `Reverted to version ${version}`, variant: 'success' }) },
      );
    }
  };

  const handleRemoveTool = (tool: string) => {
    removeAgentTool.mutate(
      { agentId, tool },
      { onSuccess: () => toast({ title: `Removed ${tool}`, variant: 'success' }) },
    );
  };

  const handleAddSelectedTools = () => {
    const tools = Array.from(selectedToolsToAdd);
    if (tools.length === 0) return;
    let completed = 0;
    for (const tool of tools) {
      addAgentTool.mutate(
        { agentId, tool },
        {
          onSuccess: () => {
            completed++;
            if (completed === tools.length) {
              toast({ title: `Added ${tools.length} tool(s)`, variant: 'success' });
              setShowAddTool(false);
              setSelectedToolsToAdd(new Set());
            }
          },
        },
      );
    }
  };

  const currentTools = agent.tools ?? [];
  const toolsNotAdded = (availableTools ?? []).filter((t) => !currentTools.includes(t.name));

  // Group tools not added by source
  const groupedToolsNotAdded = toolsNotAdded.reduce<Record<string, typeof toolsNotAdded>>((acc, tool) => {
    const group = tool.source === 'integration' ? 'Integration' : tool.source === 'custom' ? 'Custom' : 'Built-in';
    if (!acc[group]) acc[group] = [];
    acc[group].push(tool);
    return acc;
  }, {});

  const getToolDisplayName = (toolName: string): string => {
    const meta = (availableTools ?? []).find((t) => t.name === toolName);
    return meta?.displayName ?? toolName;
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Instructions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Instructions</CardTitle>
          {!editingPrompt && (
            <Button variant="ghost" size="sm" onClick={startEditPrompt}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {editingPrompt ? (
            <div className="space-y-3">
              <Textarea
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={16}
                className="font-mono text-sm w-full min-h-[200px]"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingPrompt(false)}>Cancel</Button>
                <Button size="sm" onClick={savePrompt} disabled={updateAgent.isPending}>
                  {updateAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Save</>}
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-sm bg-warm-bg rounded-lg p-4">
              {agent.systemPrompt || 'No instructions set.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Configuration */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Configuration</CardTitle>
          {configDirty && (
            <Button size="sm" onClick={saveConfig} disabled={updateAgent.isPending}>
              {updateAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Save Changes</>}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {/* Model */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Model</Label>
              <Select value={configDraft.model} onValueChange={(v) => updateConfig({ model: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                  <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                  <SelectItem value="claude-haiku-4-20250514">Claude Haiku 4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Response Depth */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Response Depth</Label>
              <Select
                value={String(configDraft.maxTurns)}
                onValueChange={(v) => updateConfig({ maxTurns: Number(v) })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Quick (10)</SelectItem>
                  <SelectItem value="25">Standard (25)</SelectItem>
                  <SelectItem value="50">Thorough (50)</SelectItem>
                  <SelectItem value="100">Unlimited (100)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Memory */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Memory</Label>
              <div className="flex items-center gap-2 mt-1.5">
                <Switch
                  checked={configDraft.memoryEnabled}
                  onCheckedChange={(v) => updateConfig({ memoryEnabled: v })}
                />
                <span className="text-sm">{configDraft.memoryEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>

            {/* Evolution */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Evolution</Label>
              <Select
                value={configDraft.selfEvolutionMode}
                onValueChange={(v) => updateConfig({ selfEvolutionMode: v })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="autonomous">Autonomous</SelectItem>
                  <SelectItem value="approve-first">Approval Required</SelectItem>
                  <SelectItem value="off">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Access */}
            <div>
              <Label className="text-warm-text-secondary text-xs">
                Access
                <InfoTooltip text="Everyone = all workspace members can use. Members Only = only users with explicit roles. Hidden = agent is invisible." />
              </Label>
              <Select
                value={configDraft.defaultAccess}
                onValueChange={(v) => updateConfig({ defaultAccess: v })}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Everyone</SelectItem>
                  <SelectItem value="viewer">Members Only</SelectItem>
                  <SelectItem value="none">Hidden</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Tools & Actions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Tools & Actions</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => { setShowAddTool(true); setSelectedToolsToAdd(new Set()); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Tool
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Action Approval setting */}
          <div>
            <Label className="text-warm-text-secondary text-xs">
              Action Approval
              <InfoTooltip text="Controls whether the agent needs approval before making changes. Automatic = no approval needed. Ask User = asks the person who triggered the agent. Ask Owner/Admins = asks an agent owner or admin to approve." />
            </Label>
            <Select value={configDraft.writePolicy} onValueChange={(v) => updateConfig({ writePolicy: v })}>
              <SelectTrigger className="mt-1 max-w-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="confirm">Ask User First</SelectItem>
                <SelectItem value="admin_confirm">Ask Owner/Admins</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tools table */}
          {currentTools.length === 0 ? (
            <p className="text-sm text-warm-text-secondary">No tools configured</p>
          ) : (
            <div className="rounded-card border border-warm-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentTools.map((tool) => (
                    <TableRow key={tool}>
                      <TableCell className="font-medium">{getToolDisplayName(tool)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500"
                          onClick={() => handleRemoveTool(tool)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-warm-text-secondary">
            Tools use team credentials by default. Configure per-tool credentials in <Link to="/connections" className="text-brand hover:underline">Connections</Link>.
          </p>
        </CardContent>
      </Card>

      {/* Add Tool Dialog */}
      <Dialog open={showAddTool} onOpenChange={setShowAddTool}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Tools</DialogTitle>
            <DialogDescription>Select tools to add to this agent.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-4">
            {toolsNotAdded.length === 0 ? (
              <p className="text-sm text-warm-text-secondary text-center py-4">All available tools are already added</p>
            ) : (
              Object.entries(groupedToolsNotAdded).map(([group, tools]) => (
                <div key={group}>
                  <p className="text-xs font-semibold text-warm-text-secondary uppercase tracking-wider mb-2">{group}</p>
                  <div className="space-y-1">
                    {tools.map((tool) => {
                      const isSelected = selectedToolsToAdd.has(tool.name);
                      return (
                        <label
                          key={tool.name}
                          className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                            isSelected ? 'border-brand bg-brand-light/20' : 'border-warm-border hover:bg-warm-bg'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedToolsToAdd((prev) => {
                                const next = new Set(prev);
                                if (next.has(tool.name)) {
                                  next.delete(tool.name);
                                } else {
                                  next.add(tool.name);
                                }
                                return next;
                              });
                            }}
                            className="h-4 w-4 rounded border-warm-border text-brand focus:ring-brand"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{tool.displayName}</p>
                            <p className="text-xs text-warm-text-secondary line-clamp-1">{tool.description}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
          {toolsNotAdded.length > 0 && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddTool(false)}>Cancel</Button>
              <Button
                onClick={handleAddSelectedTools}
                disabled={selectedToolsToAdd.size === 0 || addAgentTool.isPending}
              >
                Add Selected ({selectedToolsToAdd.size})
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Section 4: Version History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version History</CardTitle>
        </CardHeader>
        <CardContent>
          {versionsLoading ? (
            <Skeleton className="h-[100px]" />
          ) : (versions ?? []).length === 0 ? (
            <p className="text-sm text-warm-text-secondary">No version history</p>
          ) : (
            <div className="rounded-card border border-warm-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-28"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(versions ?? []).map((v, idx) => (
                    <TableRow key={v.id ?? v.version}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">v{v.version}</span>
                          {idx === 0 && <Badge variant="success" className="text-[10px]">Current</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary max-w-[200px] truncate">
                        {v.changeNote || '\u2014'}
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">{v.changedBy}</TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">
                        {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell>
                        {idx > 0 && (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPreviewVersion(v)}
                            >
                              <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRevert(v.version)}
                              disabled={revertAgent.isPending}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Version Preview Dialog */}
      <Dialog open={!!previewVersion} onOpenChange={() => setPreviewVersion(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Version {previewVersion?.version} Preview</DialogTitle>
            <DialogDescription>
              {previewVersion?.changeNote || 'No change note'} - by {previewVersion?.changedBy}{' '}
              {previewVersion?.createdAt && format(new Date(previewVersion.createdAt), 'MMM d, yyyy HH:mm')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-sm bg-warm-bg rounded-lg p-4 font-mono">
            {previewVersion?.systemPrompt || 'No instructions in this version.'}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewVersion(null)}>Close</Button>
            {previewVersion && (
              <Button onClick={() => { handleRevert(previewVersion.version); setPreviewVersion(null); }}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore This Version
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Runs Tab ----

function RunsTab({ agentId }: { agentId: string }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const params = {
    page,
    limit: 20,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
  };
  const { data, isLoading } = useAgentRuns(agentId, params);

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const runs = data?.runs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="running">Running</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-card border border-warm-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Trace ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <>
                <TableRow
                  key={run.id}
                  className={run.status === 'error' ? 'cursor-pointer' : ''}
                  onClick={() => {
                    if (run.status === 'error') {
                      setExpandedRun(expandedRun === run.id ? null : run.id);
                    }
                  }}
                >
                  <TableCell className="font-mono text-xs">{run.traceId?.slice(0, 8)}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'secondary'}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">{run.model}</TableCell>
                  <TableCell className="text-sm">{formatDuration(run.durationMs)}</TableCell>
                  <TableCell className="text-sm">{formatCost(run.estimatedCostUsd)}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {run.status === 'error' ? (
                      <span className="text-red-600">{run.output || 'Error'}</span>
                    ) : (
                      '\u2014'
                    )}
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
                {expandedRun === run.id && run.output && (
                  <TableRow key={`${run.id}-expanded`}>
                    <TableCell colSpan={7} className="bg-red-50 border-t-0">
                      <pre className="text-xs text-red-700 whitespace-pre-wrap p-2 max-h-[200px] overflow-y-auto">
                        {run.output}
                      </pre>
                    </TableCell>
                  </TableRow>
                )}
              </>
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
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
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
    </div>
  );
}

// ---- Memory Tab ----

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

      <div className="rounded-card border border-warm-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fact</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(memories ?? []).map((mem) => (
              <TableRow key={mem.id}>
                <TableCell className="max-w-[350px]">{mem.fact}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{mem.category}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={mem.source === 'agent' ? 'default' : 'warning'}>
                    {mem.source === 'agent' ? 'Agent' : 'User'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{mem.relevanceScore.toFixed(2)}</TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatDistanceToNow(new Date(mem.createdAt), { addSuffix: true })}
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
                <TableCell colSpan={6} className="text-center text-warm-text-secondary">
                  No memories stored
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Memory</DialogTitle>
            <DialogDescription>Add a fact for this agent to remember across runs.</DialogDescription>
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

// ---- Triggers Tab ----

function TriggersTab({ agentId }: { agentId: string }) {
  const { data: triggers, isLoading } = useAgentTriggers(agentId);
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const addTrigger = useAddAgentTrigger();
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState('schedule');
  const [newTriggerConfig, setNewTriggerConfig] = useState('{}');

  if (isLoading) return <Skeleton className="h-[200px]" />;

  const getTriggerIcon = (type: string) => {
    switch (type) {
      case 'slack_channel': return <MessageSquare className="h-4 w-4" />;
      case 'schedule': return <Clock className="h-4 w-4" />;
      case 'webhook': return <Webhook className="h-4 w-4" />;
      default: return <Zap className="h-4 w-4" />;
    }
  };

  const getTriggerDescription = (trigger: { type: string; config: Record<string, unknown> }) => {
    switch (trigger.type) {
      case 'slack_channel': {
        const channel = trigger.config.channelId ?? trigger.config.channel ?? 'unknown';
        const mode = trigger.config.mentionsOnly ? 'mentions only' : 'all messages';
        return `Channel ${channel} (${mode})`;
      }
      case 'schedule': {
        const cron = String(trigger.config.cron ?? trigger.config.expression ?? '');
        const tz = trigger.config.timezone ? ` (${trigger.config.timezone})` : '';
        return `${cron}${tz}`;
      }
      case 'webhook': {
        const url = trigger.config.url ?? trigger.config.webhookUrl ?? '';
        return String(url);
      }
      default: {
        const eventType = trigger.config.eventType ?? trigger.config.event ?? trigger.type;
        return `Event: ${eventType}`;
      }
    }
  };

  const handleToggle = (triggerId: string, currentEnabled: boolean) => {
    updateTrigger.mutate(
      { id: triggerId, enabled: !currentEnabled },
      { onSuccess: () => toast({ title: `Trigger ${currentEnabled ? 'paused' : 'resumed'}`, variant: 'success' }) },
    );
  };

  const handleDeleteTrigger = (triggerId: string) => {
    if (confirm('Delete this trigger? This cannot be undone.')) {
      deleteTrigger.mutate(triggerId, {
        onSuccess: () => toast({ title: 'Trigger deleted', variant: 'success' }),
      });
    }
  };

  const handleCreateTrigger = () => {
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(newTriggerConfig);
    } catch {
      toast({ title: 'Invalid JSON config', variant: 'error' });
      return;
    }
    addTrigger.mutate(
      { agentId, type: newTriggerType, config },
      {
        onSuccess: () => {
          toast({ title: 'Trigger created', variant: 'success' });
          setShowAddTrigger(false);
          setNewTriggerConfig('{}');
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowAddTrigger(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Trigger
        </Button>
      </div>

      <div className="rounded-card border border-warm-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Fired</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(triggers ?? []).map((trigger) => (
              <TableRow key={trigger.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getTriggerIcon(trigger.type)}
                    <Badge variant="default">{trigger.type}</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-warm-text-secondary max-w-[300px] truncate">
                  {getTriggerDescription(trigger)}
                </TableCell>
                <TableCell>
                  <Badge variant={trigger.enabled ? 'success' : 'secondary'}>
                    {trigger.enabled ? 'Active' : 'Paused'}
                  </Badge>
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {trigger.lastTriggeredAt
                    ? formatDistanceToNow(new Date(trigger.lastTriggeredAt), { addSuffix: true })
                    : 'Never'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleToggle(trigger.id, trigger.enabled)}
                      title={trigger.enabled ? 'Pause' : 'Resume'}
                    >
                      {trigger.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-red-600"
                      onClick={() => handleDeleteTrigger(trigger.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(triggers ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-warm-text-secondary">
                  No triggers configured
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Trigger Dialog */}
      <Dialog open={showAddTrigger} onOpenChange={setShowAddTrigger}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Trigger</DialogTitle>
            <DialogDescription>Create a new trigger for this agent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Trigger Type</Label>
              <Select value={newTriggerType} onValueChange={setNewTriggerType}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="schedule">Schedule (Cron)</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="slack_channel">Slack Channel</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="zendesk">Zendesk</SelectItem>
                  <SelectItem value="intercom">Intercom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Configuration (JSON)</Label>
              <Textarea
                value={newTriggerConfig}
                onChange={(e) => setNewTriggerConfig(e.target.value)}
                className="mt-1 font-mono text-sm"
                rows={5}
                placeholder='{"cron": "0 9 * * 1-5", "timezone": "America/New_York"}'
              />
              <p className="text-xs text-warm-text-secondary mt-1">
                {newTriggerType === 'schedule' && 'Example: {"cron": "0 9 * * 1-5", "timezone": "America/New_York"}'}
                {newTriggerType === 'webhook' && 'Example: {"secret": "my-secret"}'}
                {newTriggerType === 'slack_channel' && 'Example: {"channelId": "C...", "mentionsOnly": true}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTrigger(false)}>Cancel</Button>
            <Button onClick={handleCreateTrigger} disabled={addTrigger.isPending}>
              Create Trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Access Tab ----

function AccessTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const { data: roles, isLoading: rolesLoading } = useAgentRoles(agentId);
  const { data: upgradeRequests } = useUpgradeRequests(agentId);
  const setRole = useSetAgentRole();
  const removeRole = useRemoveAgentRole();
  const updateAccess = useUpdateAgentAccess();
  const approveUpgrade = useApproveUpgrade();
  const denyUpgrade = useDenyUpgrade();

  const [defaultAccess, setDefaultAccess] = useState(agent.defaultAccess ?? 'viewer');
  const [writePolicy, setWritePolicy] = useState(agent.writePolicy ?? 'auto');

  // Add user dialog
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newUserRole, setNewUserRole] = useState('member');

  const handleSaveAccess = () => {
    updateAccess.mutate(
      { agentId, defaultAccess },
      { onSuccess: () => toast({ title: 'Default access updated', variant: 'success' }) },
    );
  };

  const handleSaveWritePolicy = () => {
    updateAccess.mutate(
      { agentId, writePolicy },
      { onSuccess: () => toast({ title: 'Write policy updated', variant: 'success' }) },
    );
  };

  const handleAddUser = () => {
    if (!newUserId.trim()) return;
    setRole.mutate(
      { agentId, userId: newUserId, role: newUserRole },
      {
        onSuccess: () => {
          toast({ title: 'User role added', variant: 'success' });
          setShowAddUser(false);
          setNewUserId('');
        },
      },
    );
  };

  const pendingRequests = (upgradeRequests ?? []).filter((r) => r.status === 'pending');

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-brand mt-0.5 shrink-0" />
          <p className="text-sm text-warm-text">
            Access controls who can interact with this agent. Default Access sets the baseline for all workspace members. Individual roles can override the default.
          </p>
        </div>
      </div>

      {/* Default Access */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Default Access
            <InfoTooltip text="viewer = can see the agent but not send tasks. member = can use the agent. none = agent is hidden." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <Select value={defaultAccess} onValueChange={setDefaultAccess}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleSaveAccess} disabled={updateAccess.isPending}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Write Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Write Policy
            <InfoTooltip text="auto = agent can write freely. confirm = asks the user to approve writes. admin_confirm = asks an agent owner to approve writes." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1 max-w-xs">
              <Select value={writePolicy} onValueChange={setWritePolicy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="confirm">Confirm</SelectItem>
                  <SelectItem value="admin_confirm">Admin Confirm</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" onClick={handleSaveWritePolicy} disabled={updateAccess.isPending}>
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Roles</CardTitle>
            <p className="text-xs text-warm-text-secondary mt-1">
              Roles override the default access. Owner = full control. Member = can use the agent. Viewer = can see but not interact.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowAddUser(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add User
          </Button>
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
                  <TableHead>Granted By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(roles ?? []).map((role) => (
                  <TableRow key={role.userId}>
                    <TableCell className="font-medium">{role.displayName ?? role.userId}</TableCell>
                    <TableCell>
                      <Select
                        value={role.role}
                        onValueChange={(newRole) =>
                          setRole.mutate({ agentId, userId: role.userId, role: newRole })
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
                    <TableCell className="text-warm-text-secondary text-sm">{role.grantedBy ?? '-'}</TableCell>
                    <TableCell className="text-warm-text-secondary text-sm">
                      {role.grantedAt ? formatDistanceToNow(new Date(role.grantedAt), { addSuffix: true }) : '-'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeRole.mutate({ agentId, userId: role.userId })}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {(roles ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-warm-text-secondary">
                      No roles assigned
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User Role</DialogTitle>
            <DialogDescription>Assign a role to a user for this agent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User ID</Label>
              <Input
                value={newUserId}
                onChange={(e) => setNewUserId(e.target.value)}
                placeholder="Enter Slack user ID..."
                className="mt-1"
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={newUserRole} onValueChange={setNewUserRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Owner</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUser(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={setRole.isPending}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium">{req.displayName}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-warm-text-secondary text-sm">
                      {req.reason}
                    </TableCell>
                    <TableCell className="text-warm-text-secondary text-sm">
                      {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
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
