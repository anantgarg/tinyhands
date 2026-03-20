import { useState } from 'react';
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
};

const steps = ['Describe', 'Identity', 'Settings', 'Tools'];

export function AgentCreate() {
  const navigate = useNavigate();
  const createAgent = useCreateAgent();
  const analyzeGoal = useAnalyzeGoal();
  const { data: availableTools } = useAvailableTools();

  const [step, setStep] = useState(1);
  const [analyzed, setAnalyzed] = useState(false);
  const [goal, setGoal] = useState('');
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
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
      onSuccess: (result) => {
        setName(result.name);
        setAvatarEmoji(result.avatarEmoji);
        setSystemPrompt(result.systemPrompt);
        setModel(result.model);
        setSelectedTools(result.tools);
        setMentionsOnly(result.mentionsOnly);
        setMemoryEnabled(result.memoryEnabled);
        setAnalyzed(true);
        toast({ title: 'Agent configuration generated', variant: 'success' });
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

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName],
    );
  };

  const getToolDisplayName = (toolName: string): string => {
    const meta = (availableTools ?? []).find((t) => t.name === toolName);
    if (meta?.displayName) return meta.displayName;
    if (BUILTIN_FRIENDLY_NAMES[toolName]) return BUILTIN_FRIENDLY_NAMES[toolName];
    const parts = toolName.split('-');
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const base = parts.slice(0, -1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      if (['read', 'write', 'search'].includes(last)) {
        return `${base} (${last.charAt(0).toUpperCase() + last.slice(1)})`;
      }
    }
    return toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const groupedTools = (availableTools ?? []).reduce<Record<string, typeof availableTools>>((acc, tool) => {
    const group = tool.source === 'integration' ? 'Connected Services' : tool.source === 'custom' ? 'Custom Tools' : 'Core Tools';
    if (!acc[group]) acc[group] = [];
    acc[group]!.push(tool);
    return acc;
  }, {});

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

          {analyzed && (
            <Card className="mt-6">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">{avatarEmoji}</span>
                  <div>
                    <h3 className="text-lg font-bold">{name}</h3>
                    <p className="text-sm text-warm-text-secondary">{selectedTools.length} tools selected, {model.includes('opus') ? 'Opus' : model.includes('haiku') ? 'Haiku' : 'Sonnet'} model</p>
                  </div>
                </div>
                <Button onClick={() => setStep(2)}>Looks good, continue</Button>
              </CardContent>
            </Card>
          )}
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
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude-sonnet-4-20250514">Sonnet &mdash; balanced (recommended)</SelectItem>
                    <SelectItem value="claude-opus-4-20250514">Opus &mdash; most capable</SelectItem>
                    <SelectItem value="claude-haiku-4-20250514">Haiku &mdash; fastest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Effort</Label>
                <Select value={maxTurns} onValueChange={setMaxTurns}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mentions">Only when @mentioned</SelectItem>
                    <SelectItem value="relevant">Relevant messages (recommended)</SelectItem>
                    <SelectItem value="all">Every message</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Access</Label>
                <Select value={defaultAccess} onValueChange={setDefaultAccess}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Full Access</SelectItem>
                    <SelectItem value="viewer">Limited Access</SelectItem>
                    <SelectItem value="none">Invite Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Action Approval</Label>
                <Select value={writePolicy} onValueChange={setWritePolicy}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic</SelectItem>
                    <SelectItem value="confirm">Ask User First</SelectItem>
                    <SelectItem value="admin_confirm">Ask Owner/Admins</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
                <div>
                  <Label>Memory</Label>
                  <p className="text-xs text-warm-text-secondary">Remember facts across conversations</p>
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
            <h3 className="font-semibold mb-1">Select Tools</h3>
            <p className="text-sm text-warm-text-secondary mb-6">Choose what capabilities this agent should have.</p>

            {Object.entries(groupedTools).map(([group, tools]) => (
              <div key={group} className="mb-6">
                <p className="text-xs font-semibold text-warm-text-secondary uppercase tracking-wider mb-3">{group}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(tools ?? []).map((tool) => (
                    <label
                      key={tool.name}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                        selectedTools.includes(tool.name) ? "border-brand bg-brand-light/20" : "border-warm-border hover:bg-warm-bg"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTools.includes(tool.name)}
                        onChange={() => toggleTool(tool.name)}
                        className="h-4 w-4 rounded accent-brand"
                      />
                      <div>
                        <p className="text-sm font-medium">{getToolDisplayName(tool.name)}</p>
                        <p className="text-xs text-warm-text-secondary line-clamp-1">{tool.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}

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
