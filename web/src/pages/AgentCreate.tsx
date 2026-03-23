import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useCreateAgent, useAnalyzeGoal } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { toast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

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
  'google-drive-read': 'Google Drive (Read)',
  'google-drive-write': 'Google Drive (Write)',
  'google-sheets-read': 'Google Sheets (Read)',
  'google-sheets-write': 'Google Sheets (Write)',
  'google-docs-read': 'Google Docs (Read)',
  'google-docs-write': 'Google Docs (Write)',
  'gmail-read': 'Gmail (Read)',
  'gmail-write': 'Gmail (Send)',
};

const steps = ['Describe', 'Identity', 'Settings', 'Tools'];

export function AgentCreate() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.platformRole === 'superadmin' || s.user?.platformRole === 'admin');
  const createAgent = useCreateAgent();
  const analyzeGoal = useAnalyzeGoal();
  const { data: availableTools } = useAvailableTools();

  useEffect(() => {
    if (!isAdmin) navigate('/agents', { replace: true });
  }, [isAdmin, navigate]);

  const [step, setStep] = useState(1);
  const [, setAnalyzed] = useState(false);
  const [goal, setGoal] = useState('');
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('sonnet');
  const [maxTurns, setMaxTurns] = useState('25');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
  const [respondToAll, setRespondToAll] = useState(false);
  const [defaultAccess, setDefaultAccess] = useState('member');
  const [writePolicy, setWritePolicy] = useState('auto');
  const [selectedTools, setSelectedTools] = useState<string[]>([]);

  const handleAnalyze = () => {
    if (!goal.trim()) return;
    analyzeGoal.mutate(goal, {
      onSuccess: (result: any) => {
        setName(result.agentName || result.name || '');
        setAvatarEmoji(result.avatarEmoji || result.avatar_emoji || '');
        setSystemPrompt(result.systemPrompt || result.system_prompt || '');
        const m = result.model || 'sonnet';
        setModel(m.includes('opus') ? 'opus' : m.includes('haiku') ? 'haiku' : 'sonnet');
        setSelectedTools([...(result.tools || []), ...(result.custom_tools || []), ...(result.customTools || [])]);
        setMentionsOnly(result.mentionsOnly ?? result.mentions_only ?? false);
        setMemoryEnabled(result.memoryEnabled ?? result.memory_enabled ?? false);
        setAnalyzed(true);
        setStep(2); // Auto-advance to Identity step
        toast({ title: 'Configuration generated', variant: 'success' });
      },
      onError: (err) => {
        toast({ title: 'Analysis failed', description: err.message, variant: 'error' });
      },
    });
  };

  const handleCreate = () => {
    if (!name.trim() || !systemPrompt.trim()) {
      toast({ title: 'Name and instructions are required', variant: 'error' });
      return;
    }
    createAgent.mutate(
      {
        name,
        avatarEmoji: avatarEmoji || undefined,
        systemPrompt,
        model,
        tools: selectedTools,
        memoryEnabled,
        maxTurns: Number(maxTurns),
        mentionsOnly,
        respondToAllMessages: respondToAll,
        defaultAccess,
        writePolicy,
      },
      {
        onSuccess: (agent) => {
          toast({ title: 'Agent created', variant: 'success' });
          navigate(`/agents/${agent.id}`);
        },
        onError: (err) => {
          toast({ title: 'Failed to create agent', description: err.message, variant: 'error' });
        },
      },
    );
  };

  const toggleTool = (toolName: string, addAlso?: string) => {
    setSelectedTools((prev) => {
      if (prev.includes(toolName)) {
        return prev.filter((t) => t !== toolName);
      }
      const next = [...prev, toolName];
      if (addAlso && !prev.includes(addAlso)) next.push(addAlso);
      return next;
    });
  };

  const removeTool = (toolName: string) => {
    setSelectedTools((prev) => prev.filter((t) => t !== toolName));
  };

  // Group integration tools by base name (e.g. hubspot-read + hubspot-write = HubSpot)
  const integrationGroups = (() => {
    const groups: Record<string, { base: string; displayName: string; description: string; readTool?: string; writeTool?: string }> = {};
    for (const tool of (availableTools ?? [])) {
      if (tool.source !== 'integration') continue;
      const readMatch = tool.name.match(/^(.+)-(read|search)$/);
      const writeMatch = tool.name.match(/^(.+)-write$/);
      const base = readMatch?.[1] || writeMatch?.[1];
      if (!base) continue;
      if (!groups[base]) {
        const friendly = BUILTIN_FRIENDLY_NAMES[`${base}-read`] || BUILTIN_FRIENDLY_NAMES[`${base}-search`];
        const baseName = friendly ? friendly.replace(/ \(.*\)$/, '') : base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, ' ');
        groups[base] = { base, displayName: baseName, description: tool.description };
      }
      if (readMatch) groups[base].readTool = tool.name;
      if (writeMatch) groups[base].writeTool = tool.name;
    }
    return Object.values(groups);
  })();

  return (
    <div>
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      <PageHeader title="Create Agent" description="Set up a new AI agent" />

      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
              i + 1 <= step ? "bg-brand text-white" : "bg-warm-bg text-warm-text-secondary"
            )}>
              {i + 1}
            </div>
            <span className={cn("text-sm", i + 1 <= step ? "text-warm-text font-medium" : "text-warm-text-secondary")}>
              {label}
            </span>
            {i < steps.length - 1 && <div className="h-px w-8 bg-warm-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Describe */}
      {step === 1 && (
        <>
          <Card>
            <CardContent className="p-8 text-center">
              <Sparkles className="h-10 w-10 text-brand mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">What should this agent do?</h2>
              <p className="text-warm-text-secondary mb-6">Describe the agent's purpose and we'll set everything up for you.</p>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Help our support team answer customer questions using our knowledge base and create Zendesk tickets when needed..."
                className="text-base"
                rows={4}
              />
              <div className="flex justify-center gap-3 mt-6">
                <Button
                  onClick={handleAnalyze}
                  disabled={!goal.trim() || analyzeGoal.isPending}
                  size="lg"
                >
                  {analyzeGoal.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : 'Generate Configuration'}
                </Button>
              </div>
              <button
                className="text-sm text-warm-text-secondary hover:text-warm-text mt-4 underline"
                onClick={() => setStep(2)}
              >
                I'll set it up manually
              </button>
            </CardContent>
          </Card>

        </>
      )}

      {/* Step 2: Identity */}
      {step === 2 && (
        <Card>
          <CardContent className="p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-3">
                <Label>Agent Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support Assistant" className="mt-1 text-base" />
              </div>
              <div>
                <Label>Emoji</Label>
                <Input value={avatarEmoji} onChange={(e) => setAvatarEmoji(e.target.value)} placeholder="&#x1F916;" className="mt-1 text-base text-center" />
              </div>
            </div>
            <div>
              <Label>Instructions</Label>
              <p className="text-xs text-warm-text-secondary mt-1 mb-2">Tell the agent who it is, what it should do, and how it should behave.</p>
              <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={12} className="mt-1 font-mono text-sm" />
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)} disabled={!name.trim() || !systemPrompt.trim()}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Settings */}
      {step === 3 && (
        <Card>
          <CardContent className="p-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <Label>Model</Label>
                <p className="text-xs text-warm-text-secondary mt-0.5 mb-1">The AI model that powers this agent. Sonnet is best for most tasks.</p>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sonnet">Sonnet &mdash; balanced (recommended)</SelectItem>
                    <SelectItem value="opus">Opus &mdash; most capable</SelectItem>
                    <SelectItem value="haiku">Haiku &mdash; fastest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Effort</Label>
                <p className="text-xs text-warm-text-secondary mt-0.5 mb-1">How much work the agent puts into each response. Higher effort = more thorough but slower.</p>
                <Select value={maxTurns} onValueChange={setMaxTurns}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">Quick</SelectItem>
                    <SelectItem value="25">Standard (recommended)</SelectItem>
                    <SelectItem value="50">Thorough</SelectItem>
                    <SelectItem value="100">Maximum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Slack Activation</Label>
                <p className="text-xs text-warm-text-secondary mt-0.5 mb-1">When the agent responds in Slack channels it's added to.</p>
                <Select
                  value={mentionsOnly ? 'mentions' : respondToAll ? 'all' : 'relevant'}
                  onValueChange={(v) => {
                    if (v === 'mentions') {
                      setMentionsOnly(true);
                      setRespondToAll(false);
                    } else if (v === 'all') {
                      setMentionsOnly(false);
                      setRespondToAll(true);
                    } else {
                      setMentionsOnly(false);
                      setRespondToAll(false);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mentions">Only when @mentioned</SelectItem>
                    <SelectItem value="relevant">Relevant messages (recommended)</SelectItem>
                    <SelectItem value="all">Every message</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Access</Label>
                <p className="text-xs text-warm-text-secondary mt-0.5 mb-1">Who can interact with and configure this agent by default.</p>
                <Select value={defaultAccess} onValueChange={setDefaultAccess}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Full Access &mdash; everyone can use and configure</SelectItem>
                    <SelectItem value="viewer">Limited Access &mdash; everyone can use, only owners configure</SelectItem>
                    <SelectItem value="none">Invite Only &mdash; must be explicitly invited</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Action Approval</Label>
                <p className="text-xs text-warm-text-secondary mt-0.5 mb-1">Whether the agent needs permission before making changes (e.g. creating tickets, sending emails).</p>
                <Select value={writePolicy} onValueChange={setWritePolicy}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic &mdash; agent acts without asking</SelectItem>
                    <SelectItem value="confirm">Ask User First &mdash; asks the person who triggered it</SelectItem>
                    <SelectItem value="admin_confirm">Ask Owner/Admins &mdash; asks the agent's owner or admins</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
                <div>
                  <Label>Memory</Label>
                  <p className="text-xs text-warm-text-secondary">Let the agent remember facts, preferences, and context across conversations.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={() => setStep(4)}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Tools */}
      {step === 4 && (
        <Card>
          <CardContent className="p-8">
            <h3 className="font-semibold mb-1">Connected Services</h3>
            <p className="text-sm text-warm-text-secondary mb-6">Choose which services this agent can access. Core tools (file access, web search, etc.) are always available.</p>

            {integrationGroups.length === 0 ? (
              <p className="text-sm text-warm-text-secondary text-center py-8">No connected services available. Set up integrations in Connections first.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {integrationGroups.map((integ) => {
                  const hasRead = selectedTools.includes(integ.readTool || '');
                  const hasWrite = selectedTools.includes(integ.writeTool || '');
                  const isActive = hasRead || hasWrite;
                  return (
                    <div
                      key={integ.base}
                      className={cn(
                        "rounded-lg border p-4 transition-colors",
                        isActive ? "border-brand bg-brand-light/20" : "border-warm-border"
                      )}
                    >
                      <p className="text-sm font-medium mb-1">{integ.displayName}</p>
                      <p className="text-xs text-warm-text-secondary mb-3 line-clamp-1">{integ.description}</p>
                      <div className="flex gap-2">
                        {integ.readTool && (
                          <label className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors",
                            hasRead || hasWrite ? "bg-blue-100 text-blue-700" : "bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80 cursor-pointer",
                            hasWrite ? "opacity-70" : "cursor-pointer"
                          )}>
                            <input
                              type="checkbox"
                              checked={hasRead || hasWrite}
                              disabled={hasWrite}
                              onChange={() => {
                                if (hasWrite) return;
                                if (hasRead) removeTool(integ.readTool!);
                                else toggleTool(integ.readTool!);
                              }}
                              className="h-3 w-3"
                            />
                            Can view data
                          </label>
                        )}
                        {integ.writeTool && (
                          <label className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer transition-colors",
                            hasWrite ? "bg-amber-100 text-amber-700" : "bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80"
                          )}>
                            <input
                              type="checkbox"
                              checked={hasWrite}
                              onChange={() => {
                                if (hasWrite) {
                                  removeTool(integ.writeTool!);
                                } else {
                                  toggleTool(integ.writeTool!, integ.readTool);
                                }
                              }}
                              className="h-3 w-3"
                            />
                            Can make changes
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between pt-6">
              <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
              <Button onClick={handleCreate} disabled={createAgent.isPending} size="lg">
                {createAgent.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : 'Create Agent'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
