import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Pause, Play, MoreVertical, Trash2, Plus, X,
  Info, Pencil, Check, Loader2, RotateCcw, Eye,
  Webhook, Clock, MessageSquare, Zap,
  Search, Sparkles, Wand2, Cpu, FileText, RefreshCw,
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
  useAgentToolRequests,
  useCreateToolRequest,
  useAgentSkills,
  useAttachSkill,
  useDetachSkill,
  useSuggestImprovement,
  useApplyImprovement,
  usePromptSize,
} from '@/api/agents';
import type { Agent as AgentData, AgentVersion } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { useBuiltinSkills, useWorkspaceSkills } from '@/api/skills';
import { useUpdateTrigger, useDeleteTrigger } from '@/api/triggers';
import { useAgentToolConnections, useSetAgentToolConnection } from '@/api/connections';
import { useSlackChannels, useSlackUsers } from '@/api/slack';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { renderEmoji } from '@/lib/emoji';
import RichTextEditor from '@/components/RichTextEditor';
import { useAuthStore } from '@/store/auth';
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

/** Normalize model to alias used by backend */
function normalizeModelValue(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return 'sonnet';
}

/** Format snake_case category names for display */
function formatCategory(cat: string): string {
  return cat
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const BUILTIN_FRIENDLY_NAMES: Record<string, string> = {
  Bash: 'Run Commands',
  Read: 'Read Files',
  Write: 'Write Files',
  Edit: 'Edit Files',
  Glob: 'Find Files',
  Grep: 'Search Code',
  WebSearch: 'Web Search',
  WebFetch: 'Fetch Web Pages',
  NotebookEdit: 'Edit Notebooks',
  TodoWrite: 'Task Planner',
  Agent: 'Sub-Agent',
  Mcp: 'External Service',
  'serpapi-read': 'SerpAPI (Search Rankings)',
  'kb-search': 'Knowledge Base (Search)',
  'chargebee-read': 'Chargebee (Read)',
  'chargebee-write': 'Chargebee (Write)',
  'hubspot-read': 'HubSpot (Read)',
  'hubspot-write': 'HubSpot (Write)',
  'linear-read': 'Linear (Read)',
  'linear-write': 'Linear (Write)',
  'zendesk-read': 'Zendesk (Read)',
  'zendesk-write': 'Zendesk (Write)',
  'posthog-read': 'PostHog (Read)',
};

/** Get a human-readable display name for a tool slug */
function getToolDisplayName(toolName: string, availableTools?: { name: string; displayName: string }[]): string {
  const meta = (availableTools ?? []).find((t) => t.name === toolName);
  if (meta?.displayName) return meta.displayName;
  if (BUILTIN_FRIENDLY_NAMES[toolName]) return BUILTIN_FRIENDLY_NAMES[toolName];
  // Convert slugs to friendly: "serpapi-read" -> "Serpapi (Read)", "kb-search" -> "KB Search"
  const parts = toolName.split('-');
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const base = parts.slice(0, -1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    if (['read', 'write', 'search'].includes(last)) {
      return `${base} (${last.charAt(0).toUpperCase() + last.slice(1)})`;
    }
  }
  return toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convert friendly schedule settings to a cron expression */
function buildCronFromSchedule(frequency: string, time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  switch (frequency) {
    case 'hourly': return `${minute} * * * *`;
    case 'daily': return `${minute} ${hour} * * *`;
    case 'weekdays': return `${minute} ${hour} * * 1-5`;
    case 'weekly': return `${minute} ${hour} * * 1`;
    case 'monthly': return `${minute} ${hour} 1 * *`;
    default: return `${minute} ${hour} * * *`;
  }
}



export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(id!);
  const updateAgent = useUpdateAgent();
  const deleteAgentMut = useDeleteAgent();
  const [activeTab, setActiveTab] = useState('overview');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const platformRole = useAuthStore((s) => s.user?.platformRole);

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

  const canEdit = agent.userRole === 'owner' || platformRole === 'superadmin' || platformRole === 'admin';

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
              {editingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    if (nameDraft.trim() && nameDraft !== agent.name) {
                      updateAgent.mutate(
                        { id: agent.id, name: nameDraft.trim() },
                        { onSuccess: () => toast({ title: 'Name updated', variant: 'success' }) },
                      );
                    }
                    setEditingName(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') { setEditingName(false); }
                  }}
                  className="text-2xl font-extrabold bg-transparent border-b-2 border-brand outline-none px-0 py-0 w-auto min-w-[100px]"
                  style={{ width: `${Math.max(nameDraft.length, 5)}ch` }}
                />
              ) : canEdit ? (
                <h1
                  className="text-2xl font-extrabold cursor-pointer hover:text-brand transition-colors"
                  onClick={() => { setNameDraft(agent.name); setEditingName(true); }}
                  title="Click to rename"
                >
                  {agent.name}
                </h1>
              ) : (
                <h1 className="text-2xl font-extrabold">{agent.name}</h1>
              )}
              <Badge variant={agent.status === 'active' ? 'success' : 'secondary'}>
                {agent.status}
              </Badge>
              <Badge variant="secondary">{agent.model}</Badge>
            </div>
          </div>
        </div>
        {canEdit && (
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
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="learning">Learning</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="tools">
          <ToolsTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab agentId={id!} />
        </TabsContent>
        <TabsContent value="memory">
          <MemoryTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsTab agentId={id!} />
        </TabsContent>
        <TabsContent value="triggers">
          <TriggersTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="access">
          <AccessTab agentId={id!} agent={agent} />
        </TabsContent>
        <TabsContent value="learning">
          <LearningTab agentId={id!} agent={agent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Markdown Editor ----

const SLACK_EMOJI_MAP: Record<string, string> = {
  bell: '🔔', busts_in_silhouette: '👥', chart_with_upwards_trend: '📈', moneybag: '💰',
  link: '🔗', star: '⭐', warning: '⚠️', white_check_mark: '✅', x: '❌', rocket: '🚀',
  bulb: '💡', memo: '📝', email: '📧', phone: '📞', calendar: '📅', file_folder: '📁',
  page_facing_up: '📄', bar_chart: '📊', speech_balloon: '💬', thumbsup: '👍', thumbsdown: '👎',
  fire: '🔥', tada: '🎉', eyes: '👀', wave: '👋', point_right: '👉', heavy_check_mark: '✔️',
  exclamation: '❗', question: '❓', gear: '⚙️', lock: '🔒', key: '🔑', globe_with_meridians: '🌐',
  mag: '🔍', pencil: '✏️', hammer: '🔨', wrench: '🔧', shield: '🛡️', zap: '⚡',
  clock: '🕐', hourglass: '⏳', chart_with_downwards_trend: '📉', money_with_wings: '💸',
  credit_card: '💳', inbox_tray: '📥', outbox_tray: '📤', pushpin: '📌', bookmark: '🔖',
  label: '🏷️', trophy: '🏆', target: '🎯', checkered_flag: '🏁', triangular_flag_on_post: '🚩',
};

function simpleMarkdownToHtml(md: string, mentionNames?: Record<string, string>): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Slack mentions: <@U123ABC> → @DisplayName badge
    .replace(/&lt;@([A-Z0-9]+)&gt;/g, (_match, userId) => {
      const name = mentionNames?.[userId] || userId;
      return `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-medium">@${name}</span>`;
    })
    // Slack emoji codes: :bell: → 🔔
    .replace(/:([a-z0-9_+-]+):/g, (_match, code) => SLACK_EMOJI_MAP[code] || `:${code}:`)
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-3 mb-1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-warm-bg px-1 rounded text-xs">$1</code>')
    .replace(/^\- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-brand underline">$1</a>')
    .replace(/\n/g, '<br/>');
}


// ---- Overview Tab ----

function OverviewTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const updateAgent = useUpdateAgent();
  const { data: versions, isLoading: versionsLoading } = useAgentVersions(agentId);
  const revertAgent = useRevertAgent();

  // Instructions editing
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

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

  // Auto-save config changes immediately
  const autoSaveConfig = (field: string, value: unknown) => {
    updateAgent.mutate(
      { id: agentId, [field]: value } as any,
      { onSuccess: () => toast({ title: 'Updated', variant: 'success' }) },
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

  return (
    <div className="space-y-6">
      {/* Section 1: Instructions */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Instructions</CardTitle>
          {!editingPrompt && (
            <div className="flex gap-1.5">
              <SuggestImprovementButton agentId={agentId} />
              <Button variant="ghost" size="sm" onClick={startEditPrompt}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {editingPrompt ? (
            <div className="space-y-3">
              <RichTextEditor
                value={promptDraft}
                onChange={setPromptDraft}
                placeholder="Write your agent instructions here..."
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingPrompt(false)}>Cancel</Button>
                <Button size="sm" onClick={savePrompt} disabled={updateAgent.isPending}>
                  {updateAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Save</>}
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="max-h-[400px] overflow-y-auto text-sm bg-warm-bg rounded-lg p-4 prose prose-sm"
              dangerouslySetInnerHTML={{ __html: agent.systemPrompt ? simpleMarkdownToHtml(agent.systemPrompt, agent.mentionedUsers) : 'No instructions set.' }}
            />
          )}
        </CardContent>
      </Card>

      {/* Section 2: Configuration — Model + Effort */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
            {/* Model */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Model</Label>
              <Select value={normalizeModelValue(agent.model)} onValueChange={(v) => autoSaveConfig('model', v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select model" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="haiku">Haiku</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Effort */}
            <div>
              <Label className="text-warm-text-secondary text-xs">Effort</Label>
              <Select
                value={String(agent.maxTurns)}
                onValueChange={(v) => autoSaveConfig('maxTurns', Number(v))}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Quick</SelectItem>
                  <SelectItem value="25">Standard</SelectItem>
                  <SelectItem value="50">Thorough</SelectItem>
                  <SelectItem value="100">Maximum</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Version History */}
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
            <div className="rounded-card border border-warm-border overflow-x-auto">
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
                      <TableCell className="text-sm text-warm-text-secondary">{(v as any).changedByName || '\u2014'}</TableCell>
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
              {previewVersion?.changeNote || 'No change note'} - by {(previewVersion as any)?.changedByName || '\u2014'}{' '}
              {previewVersion?.createdAt && format(new Date(previewVersion.createdAt), 'MMM d, yyyy HH:mm')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-3">
            {/* Config snapshot */}
            {(previewVersion?.model || previewVersion?.maxTurns || previewVersion?.tools) && (
              <div className="grid grid-cols-2 gap-2 text-sm rounded-lg border border-warm-border p-3">
                {previewVersion?.model && (
                  <div><span className="text-warm-text-secondary">Model:</span> <span className="font-medium">{previewVersion.model.includes('sonnet') ? 'Sonnet' : previewVersion.model.includes('opus') ? 'Opus' : previewVersion.model.includes('haiku') ? 'Haiku' : previewVersion.model}</span></div>
                )}
                {previewVersion?.maxTurns && (
                  <div><span className="text-warm-text-secondary">Effort:</span> <span className="font-medium">{previewVersion.maxTurns <= 10 ? 'Quick' : previewVersion.maxTurns <= 25 ? 'Standard' : previewVersion.maxTurns <= 50 ? 'Thorough' : 'Maximum'}</span></div>
                )}
                {previewVersion?.memoryEnabled !== undefined && (
                  <div><span className="text-warm-text-secondary">Memory:</span> <span className="font-medium">{previewVersion.memoryEnabled ? 'On' : 'Off'}</span></div>
                )}
                {previewVersion?.defaultAccess && (
                  <div><span className="text-warm-text-secondary">Access:</span> <span className="font-medium">{previewVersion.defaultAccess === 'member' ? 'Full' : previewVersion.defaultAccess === 'viewer' ? 'Limited' : 'Invite Only'}</span></div>
                )}
                {previewVersion?.tools && previewVersion.tools.length > 0 && (
                  <div className="col-span-2"><span className="text-warm-text-secondary">Tools:</span> <span className="font-medium">{previewVersion.tools.join(', ')}</span></div>
                )}
              </div>
            )}
            {/* Instructions */}
            <div className="whitespace-pre-wrap text-sm bg-warm-bg rounded-lg p-4 font-mono">
              {previewVersion?.systemPrompt || 'No instructions in this version.'}
            </div>
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

// ---- Tools Tab ----

function formatAccessLevel(level: string): string {
  switch (level) {
    case 'read-write': return 'Can view & make changes';
    case 'read-only': return 'Can view data';
    default: return level;
  }
}

function ToolsTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const updateAgent = useUpdateAgent();
  const { data: availableTools } = useAvailableTools();
  const removeAgentTool = useRemoveAgentTool();
  const addAgentTool = useAddAgentTool();
  const { data: toolConnections } = useAgentToolConnections(agentId);
  const setToolConnection = useSetAgentToolConnection();
  const { data: toolRequests } = useAgentToolRequests(agentId);
  const createToolRequest = useCreateToolRequest();
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  const [showAddTool, setShowAddTool] = useState(false);
  const [selectedToolsToAdd, setSelectedToolsToAdd] = useState<Set<string>>(new Set());
  const [writePolicy, setWritePolicy] = useState(agent.writePolicy ?? 'auto');

  const pendingToolRequests = (toolRequests ?? []).filter((r) => r.status === 'pending');
  const pendingWriteTools = new Set(pendingToolRequests.filter(r => r.toolName.endsWith('-write')).map(r => r.toolName));

  const currentTools = agent.tools ?? [];
  const toolsNotAdded = (availableTools ?? []).filter((t) => !currentTools.includes(t.name));

  // Build a map of tool name -> current mode
  const toolModeMap: Record<string, string> = {};
  for (const tc of toolConnections ?? []) {
    toolModeMap[tc.toolName] = tc.mode;
  }

  const handleRemoveTool = (tool: string, silentToast?: boolean) => {
    removeAgentTool.mutate(
      { agentId, tool },
      { onSuccess: () => { if (!silentToast) toast({ title: `Removed ${getToolDisplayName(tool, availableTools)}`, variant: 'success' }); } },
    );
  };

  const handleRemoveGroup = (group: { key: string; displayName: string; readTool: string | null; writeTool: string | null; isInteg: boolean }) => {
    if (group.readTool) handleRemoveTool(group.readTool, true);
    if (group.writeTool) handleRemoveTool(group.writeTool, true);
    if (!group.isInteg) handleRemoveTool(group.key, true);
    toast({ title: `Removed ${group.displayName}`, variant: 'success' });
  };

  const handleAddSelectedTools = async () => {
    const tools = Array.from(selectedToolsToAdd);
    if (tools.length === 0) return;
    // Close dialog immediately and show adding state
    setShowAddTool(false);
    const names = tools.map(t => {
      const friendly = BUILTIN_FRIENDLY_NAMES[t];
      return friendly ? friendly.replace(/ \(.*\)$/, '') : t.replace(/-(read|write|search)$/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    });
    const uniqueNames = [...new Set(names)];
    toast({ title: `Adding ${uniqueNames.join(', ')}...`, variant: 'default' });
    for (const tool of tools) {
      addAgentTool.mutate({ agentId, tool });
    }
    setSelectedToolsToAdd(new Set());
  };


  return (
    <div className="space-y-6">
      {/* Action Approval */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Action Approval
            <InfoTooltip text="Controls whether the agent needs approval before making changes to external tools like creating tickets or updating records." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xs">
              <Select value={writePolicy} onValueChange={(v) => {
                setWritePolicy(v);
                updateAgent.mutate(
                  { id: agentId, writePolicy: v },
                  { onSuccess: () => toast({ title: 'Updated', variant: 'success' }) },
                );
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Automatic</SelectItem>
                  <SelectItem value="confirm">Ask User First</SelectItem>
                  <SelectItem value="admin_confirm">Ask Owner/Admins</SelectItem>
                </SelectContent>
              </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tools list */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Connected Tools</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => { setShowAddTool(true); setSelectedToolsToAdd(new Set()); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Tool
          </Button>
        </CardHeader>
        <CardContent>
          {currentTools.length === 0 ? (
            <p className="text-sm text-warm-text-secondary">No tools configured</p>
          ) : (
            <div className="rounded-card border border-warm-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Credentials</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    // Group integration tools by base name (chargebee-read + chargebee-write → Chargebee)
                    const grouped: { key: string; displayName: string; readTool: string | null; writeTool: string | null; isInteg: boolean }[] = [];
                    const seen = new Set<string>();
                    for (const tool of currentTools) {
                      const readMatch = tool.match(/^(.+)-(read|search)$/);
                      const writeMatch = tool.match(/^(.+)-write$/);
                      const base = readMatch ? readMatch[1] : writeMatch ? writeMatch[1] : null;
                      if (base && !seen.has(base)) {
                        seen.add(base);
                        const hasRead = currentTools.some(t => t === `${base}-read` || t === `${base}-search`);
                        const hasWrite = currentTools.includes(`${base}-write`);
                        grouped.push({
                          key: base,
                          displayName: (() => { const f = BUILTIN_FRIENDLY_NAMES[`${base}-read`] || BUILTIN_FRIENDLY_NAMES[`${base}-search`]; return f ? f.replace(/ \(.*\)$/, '') : base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' '); })(),
                          readTool: hasRead ? (currentTools.find(t => t === `${base}-read` || t === `${base}-search`) ?? null) : null,
                          writeTool: hasWrite ? `${base}-write` : null,
                          isInteg: true,
                        });
                      } else if (!base && !seen.has(tool)) {
                        seen.add(tool);
                        grouped.push({ key: tool, displayName: getToolDisplayName(tool, availableTools), readTool: null, writeTool: null, isInteg: false });
                      }
                    }
                    return grouped.map((group) => {
                      const credTool = group.readTool || group.writeTool || group.key;
                      const currentMode = toolModeMap[credTool] ?? '';
                      return (
                        <TableRow key={group.key}>
                          <TableCell className="font-medium">{group.displayName}</TableCell>
                          <TableCell>
                            {group.isInteg ? (
                              <div className="flex gap-1.5">
                                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-700">
                                  Can view data
                                </span>
                                {(availableTools ?? []).some(t => t.name === `${group.key}-write`) && (() => {
                                  const writeName = `${group.key}-write`;
                                  const isPending = pendingWriteTools.has(writeName);
                                  if (isPending) {
                                    return (
                                      <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
                                        Pending approval
                                      </span>
                                    );
                                  }
                                  return (
                                    <button
                                      onClick={() => {
                                        if (group.writeTool) {
                                          handleRemoveTool(group.writeTool);
                                        } else if (isAdmin) {
                                          addAgentTool.mutate({ agentId, tool: writeName });
                                        } else {
                                          createToolRequest.mutate(
                                            { agentId, toolName: writeName, accessLevel: 'read-write' },
                                            { onSuccess: () => toast({ title: 'Write access requested — pending admin approval', variant: 'success' }) },
                                          );
                                        }
                                      }}
                                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                        group.writeTool
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                          : 'bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80'
                                      }`}
                                    >
                                      Can make changes
                                    </button>
                                  );
                                })()}
                              </div>
                            ) : (
                              <span className="text-xs text-warm-text-secondary">&mdash;</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {group.isInteg ? (
                              <Select
                                value={currentMode}
                                onValueChange={(v) => {
                                  // Set mode for all tools in this group
                                  if (group.readTool) setToolConnection.mutate({ agentId, toolName: group.readTool, mode: v });
                                  if (group.writeTool) setToolConnection.mutate({ agentId, toolName: group.writeTool, mode: v });
                                  toast({ title: 'Updated', variant: 'success' });
                                }}
                              >
                                <SelectTrigger className={`w-[160px] h-8 text-xs ${!currentMode ? 'text-amber-600 italic border-amber-300' : ''}`}>
                                  <SelectValue placeholder="Not configured" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="team">Team credentials</SelectItem>
                                  <SelectItem value="personal">Requesting user's</SelectItem>
                                  <SelectItem value="creator">Agent creator's</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <span className="text-xs text-warm-text-secondary">&mdash;</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => handleRemoveGroup(group)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    });
                  })()}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Tool Requests */}
      {pendingToolRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Pending Tool Requests ({pendingToolRequests.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-card border border-warm-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingToolRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">
                        {getToolDisplayName(req.toolName, availableTools)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={req.accessLevel === 'read-write' ? 'warning' : 'default'} className="text-xs">
                          {formatAccessLevel(req.accessLevel)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">
                        {req.requestedByName || '\u2014'}
                      </TableCell>
                      <TableCell className="text-sm text-warm-text-secondary">
                        {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-warm-text-secondary mt-3">
              Approve or deny these requests in <Link to="/requests" className="text-brand hover:underline">Requests</Link>.
            </p>
          </CardContent>
        </Card>
      )}

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
              (() => {
                // Group available tools: integration tools by base name, others individually
                const integrationGroups: Record<string, { base: string; displayName: string; description: string; readTool?: string; writeTool?: string }> = {};
                const coreTools: typeof toolsNotAdded = [];
                for (const tool of toolsNotAdded) {
                  if (tool.source === 'integration') {
                    const readMatch = tool.name.match(/^(.+)-(read|search)$/);
                    const writeMatch = tool.name.match(/^(.+)-write$/);
                    const base = readMatch?.[1] || writeMatch?.[1];
                    if (base) {
                      if (!integrationGroups[base]) {
                        const friendly = BUILTIN_FRIENDLY_NAMES[`${base}-read`] || BUILTIN_FRIENDLY_NAMES[`${base}-search`];
                        const baseName = friendly ? friendly.replace(/ \(.*\)$/, '') : base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' ');
                        integrationGroups[base] = {
                          base,
                          displayName: baseName,
                          description: tool.description,
                        };
                      }
                      if (readMatch) integrationGroups[base].readTool = tool.name;
                      if (writeMatch) integrationGroups[base].writeTool = tool.name;
                    } else {
                      coreTools.push(tool);
                    }
                  } else {
                    coreTools.push(tool);
                  }
                }
                const integrations = Object.values(integrationGroups);
                return (
                  <>
                    {integrations.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-warm-text-secondary uppercase tracking-wider mb-2">Connected Services</p>
                        <div className="space-y-1">
                          {integrations.map((integ) => {
                            const readSelected = selectedToolsToAdd.has(integ.readTool || '');
                            const writeSelected = selectedToolsToAdd.has(integ.writeTool || '');
                            const anySelected = readSelected || writeSelected;
                            return (
                              <div
                                key={integ.base}
                                className={`rounded-lg border p-3 transition-colors ${anySelected ? 'border-brand bg-brand-light/20' : 'border-warm-border'}`}
                              >
                                <p className="text-sm font-medium mb-1">{integ.displayName}</p>
                                <p className="text-xs text-warm-text-secondary mb-2 line-clamp-1">{integ.description}</p>
                                <div className="flex gap-2">
                                  {integ.readTool && (
                                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${readSelected || writeSelected ? 'bg-blue-100 text-blue-700' : 'bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80 cursor-pointer'} ${writeSelected ? 'opacity-70' : 'cursor-pointer'}`}>
                                      <input type="checkbox" checked={readSelected || writeSelected} disabled={writeSelected} onChange={() => {
                                        if (writeSelected) return;
                                        setSelectedToolsToAdd(prev => {
                                          const next = new Set(prev);
                                          if (next.has(integ.readTool!)) next.delete(integ.readTool!); else next.add(integ.readTool!);
                                          return next;
                                        });
                                      }} className="h-3 w-3" />
                                      Can view data
                                    </label>
                                  )}
                                  {integ.writeTool && (
                                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors ${writeSelected ? 'bg-amber-100 text-amber-700' : 'bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80'}`}>
                                      <input type="checkbox" checked={writeSelected} onChange={() => {
                                        setSelectedToolsToAdd(prev => {
                                          const next = new Set(prev);
                                          if (next.has(integ.writeTool!)) {
                                            next.delete(integ.writeTool!);
                                          } else {
                                            next.add(integ.writeTool!);
                                            // Auto-add read when write is checked
                                            if (integ.readTool) next.add(integ.readTool);
                                          }
                                          return next;
                                        });
                                      }} className="h-3 w-3" />
                                      Can make changes
                                    </label>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()
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

      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Triggered By</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Cost</TableHead>
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
                  <TableCell>
                    <Badge variant={run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'secondary'}>
                      {run.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">{run.displayName || '\u2014'}</TableCell>
                  <TableCell className="text-sm">{formatDuration(run.durationMs)}</TableCell>
                  <TableCell className="text-sm">{formatCost(run.estimatedCostUsd)}</TableCell>
                  <TableCell className="text-warm-text-secondary text-sm">
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
                {expandedRun === run.id && run.output && (
                  <TableRow key={`${run.id}-expanded`}>
                    <TableCell colSpan={5} className="bg-red-50 border-t-0">
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
                <TableCell colSpan={5} className="text-center text-warm-text-secondary">
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

function MemoryTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const { data: memories, isLoading } = useAgentMemories(agentId);
  const addMemory = useAddMemory();
  const deleteMemory = useDeleteMemory();
  const clearMemories = useClearMemories();
  const updateAgent = useUpdateAgent();
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
      {/* Memory & Self-Improvement Settings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-semibold text-sm">Memory</h3>
                <p className="text-xs text-warm-text-secondary mt-1">
                  The agent remembers facts, preferences, and context from past conversations to give better responses over time.
                </p>
              </div>
              <Switch
                checked={agent.memoryEnabled}
                onCheckedChange={(v) => {
                  updateAgent.mutate(
                    { id: agentId, memoryEnabled: v },
                    { onSuccess: () => toast({ title: v ? 'Memory enabled' : 'Memory disabled', variant: 'success' }) },
                  );
                }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div>
              <h3 className="font-semibold text-sm">Self-Improvement</h3>
              <p className="text-xs text-warm-text-secondary mt-1 mb-2">
                The agent can suggest changes to its own instructions based on what it learns. This is different from Memory — Memory stores facts, Self-Improvement refines how the agent behaves.
              </p>
              <Select
                value={agent.selfEvolutionMode ?? 'off'}
                onValueChange={(v) => {
                  updateAgent.mutate(
                    { id: agentId, selfEvolutionMode: v },
                    { onSuccess: () => toast({ title: 'Self-improvement updated', variant: 'success' }) },
                  );
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="autonomous">Automatic — applies improvements on its own</SelectItem>
                  <SelectItem value="approve-first">Review First — you approve changes before they apply</SelectItem>
                  <SelectItem value="off">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Memory
        </Button>
        <Button variant="danger" size="sm" onClick={handleClear} disabled={!memories?.length}>
          Clear All
        </Button>
      </div>

      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
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
                  <Badge variant="secondary">{formatCategory(mem.category)}</Badge>
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
                    <SelectItem key={cat} value={cat}>{formatCategory(cat)}</SelectItem>
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

// ---- Skills Tab ----

function SkillsTab({ agentId }: { agentId: string }) {
  const { data: attachedSkills, isLoading } = useAgentSkills(agentId);
  const { data: builtinSkills } = useBuiltinSkills();
  const { data: workspaceSkills } = useWorkspaceSkills();
  const attachSkill = useAttachSkill();
  const detachSkill = useDetachSkill();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedSkillName, setSelectedSkillName] = useState('');
  const [permLevel, setPermLevel] = useState<string>('read');

  const handleAttach = () => {
    if (!selectedSkillName) return;
    attachSkill.mutate(
      { agentId, skillName: selectedSkillName, permissionLevel: permLevel },
      {
        onSuccess: () => {
          toast({ title: 'Skill attached', variant: 'success' });
          setShowAdd(false);
          setSelectedSkillName('');
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleDetach = (skillId: string) => {
    if (!confirm('Detach this skill from the agent?')) return;
    detachSkill.mutate(
      { agentId, skillId },
      { onSuccess: () => toast({ title: 'Skill detached', variant: 'success' }) },
    );
  };

  // Build list of available skills for the add dialog
  const availableSkills: Array<{ name: string; type: string; description: string }> = [];
  if (builtinSkills) {
    for (const s of builtinSkills.mcp) {
      availableSkills.push({ name: s.name, type: 'MCP', description: s.capabilities.join(', ') });
    }
    for (const s of builtinSkills.prompt) {
      availableSkills.push({ name: s.name, type: 'Prompt', description: s.description });
    }
  }
  if (workspaceSkills) {
    for (const s of workspaceSkills) {
      try {
        const cfg = JSON.parse(s.configJson);
        availableSkills.push({ name: s.name, type: s.skillType === 'mcp' ? 'MCP' : 'Prompt', description: cfg.description || '' });
      } catch {
        availableSkills.push({ name: s.name, type: s.skillType === 'mcp' ? 'MCP' : 'Prompt', description: '' });
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-warm-text-secondary">Attached Skills</h3>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add Skill
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : attachedSkills && attachedSkills.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {attachedSkills.map((s: any) => (
            <Card key={s.id} className="border-warm-border">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2.5">
                  {s.skillType === 'mcp' ? (
                    <Cpu className="h-4 w-4 text-blue-500 shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <span className="text-sm font-medium">{s.name}</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {s.skillType === 'mcp' ? 'MCP' : 'Prompt'}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {s.permissionLevel || 'read'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDetach(s.id)}
                  className="text-warm-text-secondary hover:text-red-600"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-warm-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Sparkles className="h-6 w-6 text-warm-text-secondary/30 mb-2" />
            <p className="text-sm text-warm-text-secondary">No skills attached</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setShowAdd(true)}>
              Add a skill
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Add Skill Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Skill</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Skill</Label>
              <Select value={selectedSkillName} onValueChange={setSelectedSkillName}>
                <SelectTrigger><SelectValue placeholder="Choose a skill" /></SelectTrigger>
                <SelectContent>
                  {availableSkills.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      <span className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-[9px] px-1">{s.type}</Badge>
                        {s.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Permission Level</Label>
              <Select value={permLevel} onValueChange={setPermLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">Read</SelectItem>
                  <SelectItem value="write">Write</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAttach} disabled={!selectedSkillName || attachSkill.isPending}>
              {attachSkill.isPending ? 'Attaching...' : 'Attach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Learning Tab ----

function LearningTab({ agentId }: { agentId: string; agent: any }) {
  const { data: promptSize } = usePromptSize(agentId);
  const { data: versions, isLoading: versionsLoading } = useAgentVersions(agentId);
  const revertAgent = useRevertAgent();
  const suggestMut = useSuggestImprovement();
  const applyMut = useApplyImprovement();
  const [feedback, setFeedback] = useState('');
  const [diff, setDiff] = useState<{ original: string; proposed: string; changeNote: string } | null>(null);
  const [previewVersion, setPreviewVersion] = useState<AgentVersion | null>(null);

  const handleAnalyze = () => {
    suggestMut.mutate(
      { agentId, feedback },
      {
        onSuccess: (data) => setDiff(data),
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleApply = () => {
    if (!diff) return;
    applyMut.mutate(
      { agentId, newPrompt: diff.proposed, changeNote: diff.changeNote },
      {
        onSuccess: () => {
          toast({ title: 'Improvement applied', variant: 'success' });
          setFeedback('');
          setDiff(null);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
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

  const tokenCount = promptSize?.tokenCount ?? 0;
  const tokenPct = Math.min(100, (tokenCount / 4000) * 100);
  const tokenColor = tokenCount < 3000 ? 'bg-green-500' : tokenCount < 4000 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="space-y-6 mt-4">
      {/* Prompt Health */}
      <Card>
        <CardContent className="p-5">
          <CardTitle className="text-base mb-3">Prompt Health</CardTitle>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-warm-text-secondary">Estimated tokens</span>
                <span className="font-medium">{tokenCount.toLocaleString()} / 4,000</span>
              </div>
              <div className="h-2 rounded-full bg-warm-sidebar overflow-hidden">
                <div className={`h-full rounded-full transition-all ${tokenColor}`} style={{ width: `${tokenPct}%` }} />
              </div>
            </div>
          </div>
          {promptSize?.warning && (
            <p className="text-xs text-amber-600 mt-2">Your instructions are getting long. Consider condensing to maintain agent effectiveness.</p>
          )}
        </CardContent>
      </Card>

      {/* Suggest Improvement (inline) */}
      <Card>
        <CardContent className="p-5">
          <CardTitle className="text-base mb-3">Suggest Improvement</CardTitle>
          <p className="text-xs text-warm-text-secondary mb-3">Describe how this agent's behavior should change. AI will analyze and propose specific prompt edits.</p>

          {!diff ? (
            <div className="space-y-3">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g., The agent should be more concise in its responses and always include source links..."
                rows={3}
              />
              <Button onClick={handleAnalyze} disabled={!feedback.trim() || suggestMut.isPending} size="sm">
                {suggestMut.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Analyzing...</>
                ) : (
                  <><Wand2 className="mr-1.5 h-3.5 w-3.5" /> Analyze &amp; Suggest</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-warm-border p-3 bg-amber-50/50">
                <p className="text-xs font-medium text-amber-700 mb-1">Proposed Change</p>
                <p className="text-sm text-amber-900">{diff.changeNote}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-warm-text-secondary mb-1">Current</p>
                  <div className="rounded-lg border border-warm-border p-3 bg-red-50/30 max-h-48 overflow-y-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono text-warm-text-secondary">{diff.original}</pre>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-warm-text-secondary mb-1">Proposed</p>
                  <div className="rounded-lg border border-warm-border p-3 bg-green-50/30 max-h-48 overflow-y-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono">{diff.proposed}</pre>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => { setDiff(null); setFeedback(''); }}>Dismiss</Button>
                <Button size="sm" onClick={handleApply} disabled={applyMut.isPending}>
                  {applyMut.isPending ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Applying...</> : <><Check className="mr-1.5 h-3.5 w-3.5" /> Apply Changes</>}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Version History */}
      <Card>
        <CardContent className="p-5">
          <CardTitle className="text-base mb-3">Version History</CardTitle>
          {versionsLoading ? (
            <Skeleton className="h-[100px]" />
          ) : (versions ?? []).length === 0 ? (
            <p className="text-sm text-warm-text-secondary">No version history</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Changes</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(versions ?? []).map((v, idx) => (
                    <TableRow key={v.id ?? v.version}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">v{v.version}</span>
                          {idx === 0 && <Badge variant="success" className="text-xs">Current</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-warm-text-secondary max-w-[200px] truncate">{v.changeNote || '\u2014'}</TableCell>
                      <TableCell className="text-xs text-warm-text-secondary">{(v as any)?.changedByName || '\u2014'}</TableCell>
                      <TableCell className="text-xs text-warm-text-secondary">
                        {v.createdAt ? formatDistanceToNow(new Date(v.createdAt), { addSuffix: true }) : '\u2014'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreviewVersion(v)}>Preview</Button>
                          {idx > 0 && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleRevert(v.version)}>
                              <RotateCcw className="mr-1 h-3 w-3" /> Restore
                            </Button>
                          )}
                        </div>
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
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Version {previewVersion?.version} Preview</DialogTitle>
            <DialogDescription>
              {previewVersion?.changeNote || 'No change note'} &mdash; {(previewVersion as any)?.changedByName || '\u2014'}{' '}
              {previewVersion?.createdAt && format(new Date(previewVersion.createdAt), 'MMM d, yyyy HH:mm')}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[400px] overflow-y-auto whitespace-pre-wrap text-xs bg-warm-sidebar rounded-btn p-4 font-mono">
            {previewVersion?.systemPrompt || 'No instructions in this version.'}
          </pre>
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

// ---- Suggest Improvement Button ----

function SuggestImprovementButton({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [diff, setDiff] = useState<{ original: string; proposed: string; changeNote: string } | null>(null);
  const suggestMut = useSuggestImprovement();
  const applyMut = useApplyImprovement();

  const handleAnalyze = () => {
    suggestMut.mutate(
      { agentId, feedback },
      {
        onSuccess: (data) => setDiff(data),
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleApply = () => {
    if (!diff) return;
    applyMut.mutate(
      { agentId, newPrompt: diff.proposed, changeNote: diff.changeNote },
      {
        onSuccess: () => {
          toast({ title: 'Improvement applied', description: 'A new version has been created', variant: 'success' });
          setOpen(false);
          setFeedback('');
          setDiff(null);
        },
        onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'error' }),
      },
    );
  };

  const handleDismiss = () => {
    setDiff(null);
    setFeedback('');
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Suggest Improvement
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setDiff(null); setFeedback(''); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Suggest Improvement</DialogTitle>
            <DialogDescription>
              Describe how the agent's behavior should change. AI will propose specific prompt edits.
            </DialogDescription>
          </DialogHeader>

          {!diff ? (
            <div className="space-y-4">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g., The agent should be more concise in its responses and always include source links..."
                rows={4}
              />
              <Button onClick={handleAnalyze} disabled={!feedback.trim() || suggestMut.isPending} className="w-full">
                {suggestMut.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
                ) : (
                  <><Wand2 className="mr-1.5 h-4 w-4" /> Analyze &amp; Suggest</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-warm-border p-3 bg-amber-50/50">
                <p className="text-xs font-medium text-amber-700 mb-1">Change Note</p>
                <p className="text-sm text-amber-900">{diff.changeNote}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-warm-text-secondary mb-1">Original</p>
                  <div className="rounded-lg border border-warm-border p-3 bg-red-50/30 max-h-60 overflow-y-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono text-warm-text-secondary">{diff.original}</pre>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-warm-text-secondary mb-1">Proposed</p>
                  <div className="rounded-lg border border-warm-border p-3 bg-green-50/30 max-h-60 overflow-y-auto">
                    <pre className="text-xs whitespace-pre-wrap font-mono">{diff.proposed}</pre>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleDismiss}>Dismiss</Button>
                <Button onClick={handleApply} disabled={applyMut.isPending}>
                  {applyMut.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying...</>
                  ) : (
                    <><Check className="mr-1.5 h-4 w-4" /> Apply</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Triggers Tab ----

function TriggersTab({ agentId, agent }: { agentId: string; agent: AgentData }) {
  const { data: triggers, isLoading } = useAgentTriggers(agentId);
  const { data: slackChannelsData, refetch: refetchChannels, isFetching: channelsFetching } = useSlackChannels();
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();
  const addTrigger = useAddAgentTrigger();
  const updateAgent = useUpdateAgent();
  const [showAddTrigger, setShowAddTrigger] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [channelSearch, setChannelSearch] = useState('');
  const [newTriggerType, setNewTriggerType] = useState('schedule');

  // Schedule-specific state
  const [scheduleFrequency, setScheduleFrequency] = useState('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleTimezone, setScheduleTimezone] = useState('America/New_York');

  if (isLoading) return <Skeleton className="h-[200px]" />;

  const currentChannelIds = agent.channelIds ?? [];
  const allChannels = slackChannelsData?.channels ?? [];
  const channelMap: Record<string, string> = {};
  // Use server-resolved names first, then Slack API data as fallback
  const serverNames = (agent as any).channelNames ?? {};
  for (const [id, name] of Object.entries(serverNames)) {
    channelMap[id] = name as string;
  }
  for (const ch of allChannels) {
    if (!channelMap[ch.id]) channelMap[ch.id] = ch.name;
  }

  const availableChannels = allChannels
    .filter((ch) => !currentChannelIds.includes(ch.id))
    .filter((ch) => !channelSearch || ch.name.toLowerCase().includes(channelSearch.toLowerCase()));

  const handleAddChannel = (channelId: string) => {
    const newIds = [...currentChannelIds, channelId];
    updateAgent.mutate(
      { id: agentId, channelIds: newIds } as any,
      {
        onSuccess: () => {
          toast({ title: `Added #${channelMap[channelId] || channelId}`, variant: 'success' });
          setShowAddChannel(false);
          setChannelSearch('');
        },
      },
    );
  };

  const handleRemoveChannel = (channelId: string) => {
    if (currentChannelIds.length <= 1) {
      toast({ title: 'Cannot remove the last channel', variant: 'error' });
      return;
    }
    const newIds = currentChannelIds.filter((id) => id !== channelId);
    updateAgent.mutate(
      { id: agentId, channelIds: newIds } as any,
      {
        onSuccess: () => toast({ title: `Removed #${channelMap[channelId] || channelId}`, variant: 'success' }),
      },
    );
  };

  const getTriggerDescription = (trigger: { type: string; config?: Record<string, unknown> }) => {
    const cfg = trigger.config || {};
    switch (trigger.type) {
      case 'schedule': {
        const cron = String(cfg.cron ?? cfg.expression ?? '');
        const tz = cfg.timezone ? ` (${cfg.timezone})` : '';
        return `${cron}${tz}`;
      }
      case 'webhook': {
        const url = cfg.url ?? cfg.webhookUrl ?? '';
        return String(url);
      }
      default: {
        const eventType = cfg.eventType ?? cfg.event ?? trigger.type;
        return `Event: ${eventType}`;
      }
    }
  };

  const getTriggerTypeName = (type: string) => {
    switch (type) {
      case 'schedule': return 'Schedule';
      case 'webhook': return 'Webhook';
      case 'linear': return 'Linear';
      case 'zendesk': return 'Zendesk';
      case 'intercom': return 'Intercom';
      default: return type;
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
    let config: Record<string, unknown> = {};

    if (newTriggerType === 'schedule') {
      const cron = buildCronFromSchedule(scheduleFrequency, scheduleTime);
      config = { cron, timezone: scheduleTimezone };
    } else if (newTriggerType === 'webhook') {
      config = {};
    }

    addTrigger.mutate(
      { agentId, type: newTriggerType, config },
      {
        onSuccess: () => {
          toast({ title: 'Trigger created', variant: 'success' });
          setShowAddTrigger(false);
          setScheduleFrequency('daily');
          setScheduleTime('09:00');
          setScheduleTimezone('America/New_York');
        },
      },
    );
  };

  const openAddDialog = () => {
    setNewTriggerType('schedule');
    setScheduleFrequency('daily');
    setScheduleTime('09:00');
    setScheduleTimezone('America/New_York');
    setShowAddTrigger(true);
  };

  const nonScheduleTriggers = (triggers ?? []).filter((t) => t.type !== 'schedule' && t.type !== 'slack_channel');

  return (
    <div className="space-y-6">
      {/* Slack Channels */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold">Slack Channels</h3>
            <p className="text-xs text-warm-text-secondary mt-1">
              Channels this agent listens and responds in.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setShowAddChannel(true); setChannelSearch(''); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Channel
          </Button>
        </div>

        {currentChannelIds.length === 0 ? (
          <div className="rounded-lg border border-warm-border bg-warm-bg p-4 text-center">
            <p className="text-sm text-warm-text-secondary">No channels assigned. Add a channel to get started.</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {currentChannelIds.map((chId) => (
              <div
                key={chId}
                className="flex items-center gap-2 rounded-lg border border-warm-border bg-white px-3 py-2"
              >
                <MessageSquare className="h-3.5 w-3.5 text-warm-text-secondary" />
                <span className="text-sm font-medium">#{channelMap[chId] || chId}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-warm-text-secondary hover:text-red-500"
                  onClick={() => handleRemoveChannel(chId)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Response Mode */}
        <div className="mt-4">
          <Label className="text-warm-text-secondary text-xs">Response Mode</Label>
          <Select
            value={agent.mentionsOnly ? 'mentions' : agent.respondToAllMessages ? 'all' : 'relevant'}
            onValueChange={(v) => {
              const update: Record<string, unknown> = { id: agentId };
              if (v === 'mentions') {
                update.mentionsOnly = true;
                update.respondToAllMessages = false;
              } else if (v === 'all') {
                update.mentionsOnly = false;
                update.respondToAllMessages = true;
              } else {
                update.mentionsOnly = false;
                update.respondToAllMessages = false;
              }
              updateAgent.mutate(update as any, {
                onSuccess: () => toast({ title: 'Updated', variant: 'success' }),
              });
            }}
          >
            <SelectTrigger className="max-w-md mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mentions">Only when @mentioned</SelectItem>
              <SelectItem value="relevant">Relevant messages</SelectItem>
              <SelectItem value="all">Every message</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Add Channel Dialog */}
      <Dialog open={showAddChannel} onOpenChange={setShowAddChannel}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Slack Channel</DialogTitle>
            <DialogDescription>Select a channel for this agent to listen in.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Search channels..."
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-[300px] overflow-y-auto space-y-1">
            {availableChannels.length === 0 ? (
              <p className="text-sm text-warm-text-secondary text-center py-4">
                {channelSearch ? 'No matching channels' : 'No available channels'}
              </p>
            ) : (
              availableChannels.map((ch) => (
                <button
                  key={ch.id}
                  className="w-full flex items-center gap-3 rounded-lg border border-warm-border p-3 text-left hover:bg-warm-bg transition-colors"
                  onClick={() => handleAddChannel(ch.id)}
                >
                  <MessageSquare className="h-4 w-4 text-warm-text-secondary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">#{ch.name}</p>
                    {ch.purpose && (
                      <p className="text-xs text-warm-text-secondary line-clamp-1">{ch.purpose}</p>
                    )}
                  </div>
                  {ch.isPrivate && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">Private</Badge>
                  )}
                </button>
              ))
            )}
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-warm-text-secondary">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Don't see your channel? Private channels need TinyHands to be invited first. Use /invite @TinyHands in the channel.</span>
          </div>
          <button
            onClick={() => refetchChannels()}
            className="mt-1.5 flex items-center gap-1 text-xs text-brand hover:text-brand/80 transition-colors"
            disabled={channelsFetching}
            type="button"
          >
            <RefreshCw className={`h-3 w-3 ${channelsFetching ? 'animate-spin' : ''}`} />
            Refresh channels
          </button>
        </DialogContent>
      </Dialog>

      {/* Scheduled Triggers */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Scheduled Triggers</h3>
          <Button variant="outline" size="sm" onClick={openAddDialog}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Trigger
          </Button>
        </div>

        <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
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
              {(triggers ?? []).filter((t) => t.type === 'schedule').map((trigger) => (
                <TableRow key={trigger.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <Badge variant="default">Schedule</Badge>
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
              {(triggers ?? []).filter((t) => t.type === 'schedule').length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-warm-text-secondary">
                    No scheduled triggers
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Other Triggers */}
      {nonScheduleTriggers.length > 0 && (
        <div>
          <h3 className="text-base font-semibold mb-4">Other Triggers</h3>
          <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
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
                {nonScheduleTriggers.map((trigger) => (
                  <TableRow key={trigger.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {trigger.type === 'webhook' ? <Webhook className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                        <Badge variant="default">{getTriggerTypeName(trigger.type)}</Badge>
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
              </TableBody>
            </Table>
          </div>
        </div>
      )}

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
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="zendesk">Zendesk</SelectItem>
                  <SelectItem value="intercom">Intercom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Schedule fields */}
            {newTriggerType === 'schedule' && (
              <div className="space-y-4">
                <div>
                  <Label>Run every</Label>
                  <div className="flex gap-2 mt-1">
                    <Select value={scheduleFrequency} onValueChange={setScheduleFrequency}>
                      <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly">Hour</SelectItem>
                        <SelectItem value="daily">Day</SelectItem>
                        <SelectItem value="weekdays">Weekday</SelectItem>
                        <SelectItem value="weekly">Week</SelectItem>
                        <SelectItem value="monthly">Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>At time</Label>
                  <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Timezone</Label>
                  <Select value={scheduleTimezone} onValueChange={setScheduleTimezone}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern (New York)</SelectItem>
                      <SelectItem value="America/Chicago">Central (Chicago)</SelectItem>
                      <SelectItem value="America/Denver">Mountain (Denver)</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific (Los Angeles)</SelectItem>
                      <SelectItem value="Europe/London">London</SelectItem>
                      <SelectItem value="Europe/Berlin">Berlin</SelectItem>
                      <SelectItem value="Asia/Kolkata">India (Kolkata)</SelectItem>
                      <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Webhook info */}
            {newTriggerType === 'webhook' && (
              <div className="rounded-lg border border-warm-border bg-warm-bg p-4">
                <p className="text-sm text-warm-text-secondary">
                  A unique webhook URL will be generated for this agent. You can use this URL to trigger the agent from any external service.
                </p>
              </div>
            )}

            {/* Linear/Zendesk/Intercom info */}
            {['linear', 'zendesk', 'intercom'].includes(newTriggerType) && (
              <div className="rounded-lg border border-warm-border bg-warm-bg p-4">
                <p className="text-sm text-warm-text-secondary">
                  {newTriggerType.charAt(0).toUpperCase() + newTriggerType.slice(1)} triggers are configured through the service's webhook settings. Make sure the {newTriggerType.charAt(0).toUpperCase() + newTriggerType.slice(1)} integration is connected in your tool settings first.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddTrigger(false)}>Cancel</Button>
            <Button
              onClick={handleCreateTrigger}
              disabled={addTrigger.isPending}
            >
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
  const { data: slackUsersData } = useSlackUsers();
  const slackUsers = slackUsersData?.users ?? [];
  const setRole = useSetAgentRole();
  const removeRole = useRemoveAgentRole();
  const updateAccess = useUpdateAgentAccess();
  const approveUpgrade = useApproveUpgrade();
  const denyUpgrade = useDenyUpgrade();

  const [defaultAccess, setDefaultAccess] = useState(agent.defaultAccess ?? 'viewer');

  // Add user dialog
  const [showAddUser, setShowAddUser] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; avatarUrl: string } | null>(null);
  const [newUserRole, setNewUserRole] = useState('member');

  const filteredUsers = userSearch.length > 0
    ? slackUsers.filter(u => {
        const search = userSearch.toLowerCase();
        return (u.realName?.toLowerCase().includes(search) || u.displayName?.toLowerCase().includes(search) || u.name?.toLowerCase().includes(search))
          && !(roles ?? []).some((r) => r.userId === u.id);
      }).slice(0, 8)
    : [];

  const handleAddUser = () => {
    if (!selectedUser) return;
    setRole.mutate(
      { agentId, userId: selectedUser.id, role: newUserRole },
      {
        onSuccess: () => {
          toast({ title: 'User role added', variant: 'success' });
          setShowAddUser(false);
          setSelectedUser(null);
          setUserSearch('');
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
            <InfoTooltip text="Controls what everyone in the workspace can do with this agent by default. Individual roles below can override this." />
          </CardTitle>
        </CardHeader>
        <CardContent>
            <div className="max-w-md">
              <Select value={defaultAccess} onValueChange={(v) => {
                setDefaultAccess(v);
                updateAccess.mutate(
                  { agentId, defaultAccess: v },
                  { onSuccess: () => toast({ title: 'Updated', variant: 'success' }) },
                );
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Full Access — everyone can use, agent performs all actions</SelectItem>
                  <SelectItem value="viewer">Limited Access — everyone can interact, agent read-only</SelectItem>
                  <SelectItem value="none">Invite Only — only people with assigned roles</SelectItem>
                </SelectContent>
              </Select>
            </div>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Roles</CardTitle>
            <p className="text-xs text-warm-text-secondary mt-1">
              Individual roles override the default access level set above.
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
            <div className="overflow-x-auto">
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
                        <SelectTrigger className="w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner">Full Control</SelectItem>
                          <SelectItem value="member">Full Access</SelectItem>
                          <SelectItem value="viewer">Limited</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-warm-text-secondary text-sm">{role.grantedByName ?? '\u2014'}</TableCell>
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add User Dialog */}
      <Dialog open={showAddUser} onOpenChange={setShowAddUser}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Search for a team member and assign a role for this agent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>User</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
                <Input
                  value={userSearch}
                  onChange={(e) => { setUserSearch(e.target.value); setSelectedUser(null); }}
                  placeholder="Type a name..."
                  className="pl-9"
                />
              </div>
              {filteredUsers.length > 0 && !selectedUser && (
                <div className="mt-1 rounded-lg border border-warm-border bg-white shadow-sm max-h-[200px] overflow-y-auto">
                  {filteredUsers.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        setSelectedUser({ id: u.id, name: u.realName || u.displayName || u.name, avatarUrl: u.avatarUrl });
                        setUserSearch(u.realName || u.displayName || u.name);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-warm-bg transition-colors text-left"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={u.avatarUrl} />
                        <AvatarFallback>{(u.realName || u.displayName || '?').charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{u.realName || u.displayName || u.name}</p>
                        {u.displayName && u.realName && u.displayName !== u.realName && (
                          <p className="text-xs text-warm-text-secondary">@{u.displayName}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedUser && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/10 p-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={selectedUser.avatarUrl} />
                    <AvatarFallback>{selectedUser.name.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1">{selectedUser.name}</span>
                  <button
                    onClick={() => { setSelectedUser(null); setUserSearch(''); }}
                    className="text-warm-text-secondary hover:text-warm-text text-lg leading-none"
                  >
                    &times;
                  </button>
                </div>
              )}
            </div>
            <div>
              <Label>Role</Label>
              <Select value={newUserRole} onValueChange={setNewUserRole}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Full Control — can edit agent settings</SelectItem>
                  <SelectItem value="member">Full Access — agent performs all actions</SelectItem>
                  <SelectItem value="viewer">Limited Access — agent read-only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddUser(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={!selectedUser || setRole.isPending}>Add</Button>
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
            <div className="overflow-x-auto">
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
