import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pause, Play, MoreVertical, Trash2, Plus, X,
  Info, Pencil, Check, Loader2, Sparkles, RotateCcw,
  Webhook, Clock, MessageSquare, Zap, Send,
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
  useAnalyzeGoal,
  useAgentTriggers,
} from '@/api/agents';
import type { Agent as AgentData } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { useUpdateTrigger, useDeleteTrigger } from '@/api/triggers';
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

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(id!);
  const updateAgent = useUpdateAgent();
  const deleteAgentMut = useDeleteAgent();
  const [activeTab, setActiveTab] = useState('overview');

  // AI Update bar state
  const [aiGoal, setAiGoal] = useState('');
  const [showAiPreview, setShowAiPreview] = useState(false);
  const analyzeGoal = useAnalyzeGoal();
  const [aiChanges, setAiChanges] = useState<Record<string, { from: unknown; to: unknown }> | null>(null);

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

  const handleAiAnalyze = () => {
    if (!aiGoal.trim()) return;
    analyzeGoal.mutate(aiGoal, {
      onSuccess: (result) => {
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (result.changes) {
          Object.assign(changes, result.changes);
        } else {
          if (result.systemPrompt && result.systemPrompt !== agent.systemPrompt) {
            changes.systemPrompt = { from: agent.systemPrompt?.slice(0, 80) + '...', to: result.systemPrompt.slice(0, 80) + '...' };
          }
          if (result.model && result.model !== agent.model) {
            changes.model = { from: agent.model, to: result.model };
          }
          if (result.tools && JSON.stringify(result.tools) !== JSON.stringify(agent.tools)) {
            changes.tools = { from: agent.tools, to: result.tools };
          }
          if (result.memoryEnabled !== agent.memoryEnabled) {
            changes.memoryEnabled = { from: agent.memoryEnabled, to: result.memoryEnabled };
          }
        }
        setAiChanges(changes);
        setShowAiPreview(true);
      },
      onError: (err) => {
        toast({ title: 'Analysis failed', description: err.message, variant: 'error' });
      },
    });
  };

  const handleApplyAiChanges = () => {
    if (!aiChanges) return;
    const payload: Record<string, unknown> = { id: agent.id };
    for (const [key, val] of Object.entries(aiChanges)) {
      payload[key] = val.to;
    }
    updateAgent.mutate(payload as unknown as Parameters<typeof updateAgent.mutate>[0], {
      onSuccess: () => {
        toast({ title: 'Agent updated with AI changes', variant: 'success' });
        setShowAiPreview(false);
        setAiGoal('');
        setAiChanges(null);
      },
    });
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
          <span className="text-3xl">{agent.avatarEmoji || '🤖'}</span>
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

      {/* AI Update Bar */}
      <Card className="mb-6">
        <CardContent className="py-3 px-4">
          <div className="flex gap-3 items-center">
            <Sparkles className="h-4 w-4 text-brand shrink-0" />
            <Input
              value={aiGoal}
              onChange={(e) => setAiGoal(e.target.value)}
              placeholder="Describe changes you want to make to this agent..."
              className="flex-1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAiAnalyze(); }}
            />
            <Button
              size="sm"
              onClick={handleAiAnalyze}
              disabled={!aiGoal.trim() || analyzeGoal.isPending}
            >
              {analyzeGoal.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI Preview Dialog */}
      <Dialog open={showAiPreview} onOpenChange={setShowAiPreview}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proposed Changes</DialogTitle>
            <DialogDescription>Review the AI-suggested changes before applying.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {aiChanges && Object.entries(aiChanges).map(([key, val]) => (
              <div key={key} className="rounded-lg border border-warm-border p-3">
                <p className="text-sm font-medium mb-1 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-warm-text-secondary">From:</span>
                    <p className="text-red-600 mt-0.5 break-words">{typeof val.from === 'object' ? JSON.stringify(val.from) : String(val.from)}</p>
                  </div>
                  <div>
                    <span className="text-warm-text-secondary">To:</span>
                    <p className="text-emerald-700 mt-0.5 break-words">{typeof val.to === 'object' ? JSON.stringify(val.to) : String(val.to)}</p>
                  </div>
                </div>
              </div>
            ))}
            {aiChanges && Object.keys(aiChanges).length === 0 && (
              <p className="text-sm text-warm-text-secondary text-center py-4">No changes detected</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAiPreview(false)}>Cancel</Button>
            <Button onClick={handleApplyAiChanges} disabled={!aiChanges || Object.keys(aiChanges).length === 0}>
              Apply Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  const [editingConfig, setEditingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState({
    model: agent.model,
    maxTurns: agent.maxTurns,
    mentionsOnly: agent.mentionsOnly,
    respondToAllMessages: agent.respondToAllMessages,
    relevanceKeywords: agent.relevanceKeywords ?? [],
    memoryEnabled: agent.memoryEnabled,
    selfEvolutionMode: agent.selfEvolutionMode ?? 'off',
    writePolicy: agent.writePolicy ?? 'auto',
    defaultAccess: agent.defaultAccess ?? 'member',
    streamingDetail: agent.streamingDetail ?? false,
  });
  const [keywordInput, setKeywordInput] = useState('');

  // Tool dialog
  const [showAddTool, setShowAddTool] = useState(false);

  const respondToValue = configDraft.mentionsOnly ? 'mentions' : configDraft.relevanceKeywords.length > 0 ? 'keywords' : 'all';

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

  const startEditConfig = () => {
    setConfigDraft({
      model: agent.model,
      maxTurns: agent.maxTurns,
      mentionsOnly: agent.mentionsOnly,
      respondToAllMessages: agent.respondToAllMessages,
      relevanceKeywords: agent.relevanceKeywords ?? [],
      memoryEnabled: agent.memoryEnabled,
      selfEvolutionMode: agent.selfEvolutionMode ?? 'off',
      writePolicy: agent.writePolicy ?? 'auto',
      defaultAccess: agent.defaultAccess ?? 'member',
      streamingDetail: agent.streamingDetail ?? false,
    });
    setEditingConfig(true);
  };

  const saveConfig = () => {
    updateAgent.mutate(
      { id: agentId, ...configDraft },
      {
        onSuccess: () => {
          setEditingConfig(false);
          toast({ title: 'Configuration updated', variant: 'success' });
        },
      },
    );
  };

  const handleRespondToChange = (value: string) => {
    if (value === 'mentions') {
      setConfigDraft((d) => ({ ...d, mentionsOnly: true, respondToAllMessages: false, relevanceKeywords: [] }));
    } else if (value === 'all') {
      setConfigDraft((d) => ({ ...d, mentionsOnly: false, respondToAllMessages: true, relevanceKeywords: [] }));
    } else {
      setConfigDraft((d) => ({ ...d, mentionsOnly: false, respondToAllMessages: false }));
    }
  };

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (kw && !configDraft.relevanceKeywords.includes(kw)) {
      setConfigDraft((d) => ({ ...d, relevanceKeywords: [...d.relevanceKeywords, kw] }));
      setKeywordInput('');
    }
  };

  const removeKeyword = (kw: string) => {
    setConfigDraft((d) => ({ ...d, relevanceKeywords: d.relevanceKeywords.filter((k) => k !== kw) }));
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

  const handleAddTool = (tool: string) => {
    addAgentTool.mutate(
      { agentId, tool },
      { onSuccess: () => toast({ title: `Added ${tool}`, variant: 'success' }) },
    );
  };

  const currentTools = agent.tools ?? [];
  const toolsNotAdded = (availableTools ?? []).filter((t) => !currentTools.includes(t.name));

  // Group tools by source
  const groupedTools = currentTools.reduce<Record<string, string[]>>((acc, toolName) => {
    const toolMeta = (availableTools ?? []).find((t) => t.name === toolName);
    const group = toolMeta?.source === 'integration' ? 'Integration' : toolMeta?.source === 'custom' ? 'Custom' : 'Built-in';
    if (!acc[group]) acc[group] = [];
    acc[group].push(toolName);
    return acc;
  }, {});

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
                className="font-mono text-sm"
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
          {!editingConfig ? (
            <Button variant="ghost" size="sm" onClick={startEditConfig}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditingConfig(false)}>Cancel</Button>
              <Button size="sm" onClick={saveConfig} disabled={updateAgent.isPending}>
                {updateAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Save</>}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-8 gap-y-5">
            {/* Model */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Model</Label>
              {editingConfig ? (
                <Select value={configDraft.model} onValueChange={(v) => setConfigDraft((d) => ({ ...d, model: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                    <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                    <SelectItem value="claude-haiku-4-20250514">Claude Haiku 4</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-1">{agent.model}</p>
              )}
            </div>

            {/* Max Turns */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Max Turns</Label>
              {editingConfig ? (
                <Input
                  type="number"
                  value={configDraft.maxTurns}
                  onChange={(e) => setConfigDraft((d) => ({ ...d, maxTurns: Number(e.target.value) }))}
                  className="mt-1"
                />
              ) : (
                <p className="text-sm mt-1">{agent.maxTurns}</p>
              )}
            </div>

            {/* Channels */}
            <div className="col-span-2">
              <Label className="text-warm-text-secondary text-xs">Channels</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(agent.channelIds ?? []).map((ch) => (
                  <Badge key={ch} variant="secondary">{ch}</Badge>
                ))}
                {(agent.channelIds ?? []).length === 0 && (
                  <p className="text-sm text-warm-text-secondary">No channels configured</p>
                )}
              </div>
            </div>

            {/* Respond To */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Respond To</Label>
              {editingConfig ? (
                <Select value={respondToValue} onValueChange={handleRespondToChange}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mentions">Mentions Only</SelectItem>
                    <SelectItem value="all">All Messages</SelectItem>
                    <SelectItem value="keywords">Keywords</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-1">
                  {agent.mentionsOnly ? 'Mentions Only' : agent.relevanceKeywords?.length ? 'Keywords' : 'All Messages'}
                </p>
              )}
            </div>

            {/* Keywords (conditional) */}
            {editingConfig && respondToValue === 'keywords' && (
              <div>
                <Label className="text-warm-text-secondary text-xs">Keywords</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    placeholder="Add keyword..."
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                  />
                  <Button variant="outline" size="sm" onClick={addKeyword}>Add</Button>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {configDraft.relevanceKeywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="gap-1">
                      {kw}
                      <button onClick={() => removeKeyword(kw)} className="hover:text-red-600">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Memory */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Memory</Label>
              {editingConfig ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <Switch
                    checked={configDraft.memoryEnabled}
                    onCheckedChange={(v) => setConfigDraft((d) => ({ ...d, memoryEnabled: v }))}
                  />
                  <span className="text-sm">{configDraft.memoryEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
              ) : (
                <p className="text-sm mt-1">{agent.memoryEnabled ? 'Enabled' : 'Disabled'}</p>
              )}
            </div>

            {/* Evolution Mode */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Evolution Mode</Label>
              {editingConfig ? (
                <Select value={configDraft.selfEvolutionMode} onValueChange={(v) => setConfigDraft((d) => ({ ...d, selfEvolutionMode: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="autonomous">Autonomous</SelectItem>
                    <SelectItem value="approve-first">Approve First</SelectItem>
                    <SelectItem value="off">Off</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-1 capitalize">{agent.selfEvolutionMode ?? 'Off'}</p>
              )}
            </div>

            {/* Write Policy */}
            <div>
              <Label className="text-warm-text-secondary text-xs">
                Write Policy
                <InfoTooltip text="auto = agent can write freely. confirm = asks the user to approve writes. admin_confirm = asks an agent owner to approve writes." />
              </Label>
              {editingConfig ? (
                <Select value={configDraft.writePolicy} onValueChange={(v) => setConfigDraft((d) => ({ ...d, writePolicy: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="confirm">Confirm</SelectItem>
                    <SelectItem value="admin_confirm">Admin Confirm</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-1 capitalize">{agent.writePolicy ?? 'auto'}</p>
              )}
            </div>

            {/* Default Access */}
            <div>
              <Label className="text-warm-text-secondary text-xs">
                Default Access
                <InfoTooltip text="viewer = can see the agent but not send tasks. member = can use the agent. none = agent is hidden." />
              </Label>
              {editingConfig ? (
                <Select value={configDraft.defaultAccess} onValueChange={(v) => setConfigDraft((d) => ({ ...d, defaultAccess: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm mt-1 capitalize">{agent.defaultAccess ?? 'member'}</p>
              )}
            </div>

            {/* Streaming Detail */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Streaming Detail</Label>
              {editingConfig ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <Switch
                    checked={configDraft.streamingDetail}
                    onCheckedChange={(v) => setConfigDraft((d) => ({ ...d, streamingDetail: v }))}
                  />
                  <span className="text-sm">{configDraft.streamingDetail ? 'Enabled' : 'Disabled'}</span>
                </div>
              ) : (
                <p className="text-sm mt-1">{agent.streamingDetail ? 'Enabled' : 'Disabled'}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Tools */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Tools</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setShowAddTool(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Tool
          </Button>
        </CardHeader>
        <CardContent>
          {currentTools.length === 0 ? (
            <p className="text-sm text-warm-text-secondary">No tools configured</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(groupedTools).map(([group, tools]) => (
                <div key={group}>
                  <p className="text-xs font-semibold text-warm-text-secondary uppercase tracking-wider mb-2">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {tools.map((tool) => {
                      const meta = (availableTools ?? []).find((t) => t.name === tool);
                      return (
                        <Badge key={tool} variant="secondary" className="gap-1.5 pr-1.5">
                          {meta?.displayName ?? tool}
                          <button
                            onClick={() => handleRemoveTool(tool)}
                            className="hover:text-red-600 transition-colors"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Tool Dialog */}
      <Dialog open={showAddTool} onOpenChange={setShowAddTool}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Tool</DialogTitle>
            <DialogDescription>Select tools to add to this agent.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {toolsNotAdded.length === 0 ? (
              <p className="text-sm text-warm-text-secondary text-center py-4">All available tools are already added</p>
            ) : (
              toolsNotAdded.map((tool) => (
                <label
                  key={tool.name}
                  className="flex items-center gap-3 rounded-lg border border-warm-border p-3 cursor-pointer hover:bg-warm-bg transition-colors"
                  onClick={() => {
                    handleAddTool(tool.name);
                    setShowAddTool(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{tool.displayName}</p>
                    <p className="text-xs text-warm-text-secondary line-clamp-1">{tool.description}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{tool.source}</Badge>
                </label>
              ))
            )}
          </div>
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
            <div className="space-y-3">
              {(versions ?? []).map((v, idx) => (
                <div key={v.id ?? v.version} className="flex items-start justify-between border-b border-warm-border pb-3 last:border-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">Version {v.version}</p>
                      {idx === 0 && <Badge variant="success" className="text-[10px]">Current</Badge>}
                    </div>
                    {v.changeNote && (
                      <p className="text-xs text-warm-text-secondary mt-0.5">{v.changeNote}</p>
                    )}
                    <p className="text-xs text-warm-text-secondary mt-0.5">
                      by {v.changedBy} - {format(new Date(v.createdAt), 'MMM d, yyyy HH:mm')}
                    </p>
                  </div>
                  {idx > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevert(v.version)}
                      disabled={revertAgent.isPending}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Revert
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Runs Tab ----

function RunsTab({ agentId }: { agentId: string }) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
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
                <TableCell className="font-mono text-xs">{run.traceId?.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{run.slackUserId}</TableCell>
                <TableCell>
                  <Badge variant={run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'secondary'}>
                    {run.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">{run.model}</TableCell>
                <TableCell className="text-sm">{formatDuration(run.durationMs)}</TableCell>
                <TableCell className="text-sm">{formatCost(run.estimatedCostUsd)}</TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
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
              <TableHead>Relevance</TableHead>
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

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-warm-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Triggered</TableHead>
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
              Roles override the default access. Owner = full control (edit config, manage roles). Member = can use the agent. Viewer = can see but not interact.
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
