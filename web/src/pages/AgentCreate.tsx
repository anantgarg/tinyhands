import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useCreateAgent, useAnalyzeGoal } from '@/api/agents';
import { useAvailableTools } from '@/api/tools';
import { toast } from '@/components/ui/use-toast';

export function AgentCreate() {
  const navigate = useNavigate();
  const createAgent = useCreateAgent();
  const analyzeGoal = useAnalyzeGoal();
  const { data: availableTools } = useAvailableTools();

  const [goal, setGoal] = useState('');
  const [name, setName] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [channelIds, setChannelIds] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-20250514');
  const [maxTurns, setMaxTurns] = useState('25');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [mentionsOnly, setMentionsOnly] = useState(false);
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
        channelIds: channelIds.split(',').map((c) => c.trim()).filter(Boolean),
        memoryEnabled,
        maxTurns: Number(maxTurns),
        mentionsOnly,
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

  return (
    <div>
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-warm-text-secondary hover:text-warm-text mb-4">
        <ArrowLeft className="h-4 w-4" />
        Agents
      </Link>

      <PageHeader title="Create Agent" description="Set up a new AI agent" />

      {/* Goal-based creation */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand" />
            Goal-based Setup
          </CardTitle>
          <CardDescription>
            Describe what you want your agent to do and we will generate the configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. I want an agent that helps our support team answer customer questions using our knowledge base and can create Zendesk tickets..."
              className="flex-1"
              rows={3}
            />
            <Button
              onClick={handleAnalyze}
              disabled={!goal.trim() || analyzeGoal.isPending}
              className="shrink-0 self-end"
            >
              {analyzeGoal.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...</>
              ) : (
                'Analyze & Generate'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="relative my-8">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-warm-bg px-4 text-sm text-warm-text-secondary">
          or configure manually
        </span>
      </div>

      {/* Manual config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Avatar (emoji)</Label>
              <Input
                value={avatarEmoji}
                onChange={(e) => setAvatarEmoji(e.target.value)}
                placeholder="🤖"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label>Instructions *</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant that..."
              className="mt-1"
              rows={8}
            />
          </div>

          <div>
            <Label>Channels (comma separated)</Label>
            <Input
              value={channelIds}
              onChange={(e) => setChannelIds(e.target.value)}
              placeholder="#general, #support"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-4-20250514">Claude Sonnet 4</SelectItem>
                  <SelectItem value="claude-opus-4-20250514">Claude Opus 4</SelectItem>
                  <SelectItem value="claude-haiku-4-20250514">Claude Haiku 4</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Max Turns</Label>
              <Input
                type="number"
                value={maxTurns}
                onChange={(e) => setMaxTurns(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Respond To</Label>
              <Select value={mentionsOnly ? 'mentions' : 'all'} onValueChange={(v) => setMentionsOnly(v === 'mentions')}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Messages</SelectItem>
                  <SelectItem value="mentions">Mentions Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={memoryEnabled} onCheckedChange={setMemoryEnabled} />
            <Label>Enable Memory</Label>
          </div>

          <Separator />

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
                  <SelectItem value="none">None</SelectItem>
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
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="confirm">Confirm</SelectItem>
                  <SelectItem value="admin_confirm">Admin Confirm</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div>
            <Label className="mb-3 block">Tools</Label>
            <div className="grid grid-cols-2 gap-2">
              {(availableTools ?? []).map((tool) => (
                <label
                  key={tool.name}
                  className="flex items-center gap-2 rounded-lg border border-warm-border p-3 cursor-pointer hover:bg-warm-bg transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedTools.includes(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                    className="rounded accent-brand"
                  />
                  <div>
                    <p className="text-sm font-medium">{tool.displayName}</p>
                    <p className="text-xs text-warm-text-secondary line-clamp-1">{tool.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate('/agents')}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createAgent.isPending}>
              {createAgent.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</>
              ) : (
                'Create Agent'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
