import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Shield, HelpCircle, Key, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettings, useUpdateSettings, useAnthropicKeyStatus, useTestAnthropicKey, useSaveAnthropicKey } from '@/api/settings';
import { useAuthStore } from '@/store/auth';
import { toast } from '@/components/ui/use-toast';

export function Settings() {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Shield className="h-12 w-12 text-warm-text-secondary mb-4" />
        <h2 className="text-lg font-bold">Admin Access Required</h2>
        <p className="text-warm-text-secondary mt-2">You need admin permissions to access this page.</p>
      </div>
    );
  }
  return <SettingsContent />;
}

function SettingsContent() {
  const { data: settings, isLoading, isError } = useSettings();
  const updateSettings = useUpdateSettings();

  const [general, setGeneral] = useState({
    workspaceName: '',
    defaultModel: 'sonnet',
    dailyBudgetUsd: 50,
  });
  const [defaults, setDefaults] = useState({
    defaultAccess: 'member',
    writePolicy: 'allow',
    maxTurns: 25,
    memoryEnabled: false,
  });
  const [rateLimits, setRateLimits] = useState({
    tpmLimit: 100000,
    rpmLimit: 60,
    concurrentRunsLimit: 10,
  });
  const [alerts, setAlerts] = useState({
    errorRateThreshold: 0.1,
    costAlertThreshold: 10,
    durationAlertThreshold: 60000,
  });

  useEffect(() => {
    if (settings) {
      if (settings.general) {
        setGeneral({
          workspaceName: settings.general.workspaceName ?? '',
          defaultModel: settings.general.defaultModel ?? 'sonnet',
          dailyBudgetUsd: settings.general.dailyBudgetUsd ?? 50,
        });
      }
      if (settings.defaults) {
        setDefaults({
          defaultAccess: settings.defaults.defaultAccess ?? 'member',
          writePolicy: settings.defaults.writePolicy ?? 'allow',
          maxTurns: settings.defaults.maxTurns ?? 25,
          memoryEnabled: settings.defaults.memoryEnabled ?? false,
        });
      }
      if (settings.rateLimits) {
        setRateLimits({
          tpmLimit: settings.rateLimits.tpmLimit ?? 100000,
          rpmLimit: settings.rateLimits.rpmLimit ?? 60,
          concurrentRunsLimit: settings.rateLimits.concurrentRunsLimit ?? 10,
        });
      }
      if (settings.alerts) {
        setAlerts({
          errorRateThreshold: settings.alerts.errorRateThreshold ?? 0.1,
          costAlertThreshold: settings.alerts.costAlertThreshold ?? 10,
          durationAlertThreshold: settings.alerts.durationAlertThreshold ?? 60000,
        });
      }
    }
  }, [settings]);

  const handleSave = (section: string) => {
    const data = { general, defaults, rateLimits, alerts };
    updateSettings.mutate(
      { [section]: data[section as keyof typeof data] },
      {
        onSuccess: () => toast({ title: 'Settings saved', variant: 'success' }),
        onError: (err) => toast({ title: 'Failed to save', description: err.message, variant: 'error' }),
      },
    );
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Workspace Settings" />
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[200px]" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="Workspace Settings" />
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            <p>Failed to load workspace settings. Please try refreshing.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Workspace Settings" description="Configure platform defaults and limits" />

      <AnthropicKeyCard />

      {/* General */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Basic workspace configuration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Workspace Name</Label>
              <Input
                value={general.workspaceName ?? ''}
                onChange={(e) => setGeneral({ ...general, workspaceName: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Default Model</Label>
              <Select
                value={general.defaultModel ?? 'sonnet'}
                onValueChange={(v) => setGeneral({ ...general, defaultModel: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">Opus — most capable, best for complex tasks</SelectItem>
                  <SelectItem value="sonnet">Sonnet — balanced speed and quality (recommended)</SelectItem>
                  <SelectItem value="haiku">Haiku — fastest, good for simple tasks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="max-w-xs">
            <Label>Daily Budget (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={general.dailyBudgetUsd ?? 50}
              onChange={(e) => setGeneral({ ...general, dailyBudgetUsd: Number(e.target.value) })}
              className="mt-1"
            />
            <p className="text-xs text-warm-text-secondary mt-1">Maximum daily spend across all agents</p>
          </div>
          <Button size="sm" onClick={() => handleSave('general')} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save General
          </Button>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Agent Defaults</CardTitle>
          <CardDescription>Default settings applied to new agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Who can use new agents?</Label>
              <Select
                value={defaults.defaultAccess ?? 'member'}
                onValueChange={(v) => setDefaults({ ...defaults, defaultAccess: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Restricted (admins only)</SelectItem>
                  <SelectItem value="member">Everyone (all workspace members)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-warm-text-secondary mt-1">Who can interact with newly created agents by default</p>
            </div>
            <div>
              <Label>When agents want to take actions</Label>
              <Select
                value={defaults.writePolicy ?? 'allow'}
                onValueChange={(v) => setDefaults({ ...defaults, writePolicy: v })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Automatic (no approval needed)</SelectItem>
                  <SelectItem value="confirm">Ask the user for approval</SelectItem>
                  <SelectItem value="admin_confirm">Require admin approval</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-warm-text-secondary mt-1">Controls whether agents need permission before taking actions like creating tickets or updating records</p>
            </div>
          </div>
          <div className="max-w-xs">
            <Label>Default Effort Level</Label>
            <Select
              value={String(defaults.maxTurns ?? 25)}
              onValueChange={(v) => setDefaults({ ...defaults, maxTurns: Number(v) })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">Quick — fast responses, minimal tool use</SelectItem>
                <SelectItem value="25">Standard — balanced (recommended)</SelectItem>
                <SelectItem value="50">Thorough — deeper analysis, more tool calls</SelectItem>
                <SelectItem value="100">Maximum — exhaustive, no shortcuts</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-warm-text-secondary mt-1">How thorough agents are when responding to messages</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={defaults.memoryEnabled ?? false}
              onCheckedChange={(checked) => setDefaults({ ...defaults, memoryEnabled: checked })}
            />
            <div>
              <Label>Enable Memory by Default</Label>
              <p className="text-xs text-warm-text-secondary">Agents remember facts across conversations</p>
            </div>
          </div>
          <Button size="sm" onClick={() => handleSave('defaults')} disabled={updateSettings.isPending}>
            Save Defaults
          </Button>
        </CardContent>
      </Card>

      {/* Rate Limits */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Rate Limits</CardTitle>
          <CardDescription>Control API usage and concurrency</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label>Tokens per Minute</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-warm-text-secondary cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-[220px] text-xs">Tokens are units of text processed by the AI. This limits how much text all agents can process each minute combined.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="number"
                value={rateLimits.tpmLimit ?? 100000}
                onChange={(e) => setRateLimits({ ...rateLimits, tpmLimit: Number(e.target.value) })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Max tokens processed per minute</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Label>Requests per Minute</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-warm-text-secondary cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-[220px] text-xs">Each time an agent calls the AI counts as one request. This limits how many calls all agents can make per minute.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="number"
                value={rateLimits.rpmLimit ?? 60}
                onChange={(e) => setRateLimits({ ...rateLimits, rpmLimit: Number(e.target.value) })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Max API requests per minute</p>
            </div>
            <div>
              <Label>Concurrent Runs</Label>
              <Input
                type="number"
                value={rateLimits.concurrentRunsLimit ?? 10}
                onChange={(e) => setRateLimits({ ...rateLimits, concurrentRunsLimit: Number(e.target.value) })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Max simultaneous agent runs</p>
            </div>
          </div>
          <Button size="sm" onClick={() => handleSave('rateLimits')} disabled={updateSettings.isPending}>
            Save Rate Limits
          </Button>
        </CardContent>
      </Card>

      {/* Alert Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert Thresholds</CardTitle>
          <CardDescription>Configure when alerts are triggered</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Error Rate Threshold (%)</Label>
              <Input
                type="number"
                step="1"
                value={Math.round((alerts.errorRateThreshold ?? 0.1) * 100)}
                onChange={(e) => setAlerts({ ...alerts, errorRateThreshold: Number(e.target.value) / 100 })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Alert when error rate exceeds this</p>
            </div>
            <div>
              <Label>Cost Alert ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={alerts.costAlertThreshold ?? 10}
                onChange={(e) => setAlerts({ ...alerts, costAlertThreshold: Number(e.target.value) })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Alert when single run cost exceeds this</p>
            </div>
            <div>
              <Label>Duration Alert (seconds)</Label>
              <Input
                type="number"
                value={Math.round((alerts.durationAlertThreshold ?? 60000) / 1000)}
                onChange={(e) => setAlerts({ ...alerts, durationAlertThreshold: Number(e.target.value) * 1000 })}
                className="mt-1"
              />
              <p className="text-xs text-warm-text-secondary mt-1">Alert when run takes longer than this</p>
            </div>
          </div>
          <Button size="sm" onClick={() => handleSave('alerts')} disabled={updateSettings.isPending}>
            Save Alert Thresholds
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AnthropicKeyCard() {
  const { data: status, isLoading } = useAnthropicKeyStatus();
  const testKey = useTestAnthropicKey();
  const saveKey = useSaveAnthropicKey();

  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  const configured = status?.configured === true;

  const handleTest = async () => {
    if (!apiKey) return;
    setTestResult(null);
    try {
      const result = await testKey.mutateAsync(apiKey);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ ok: false, reason: err.message });
    }
  };

  const handleSave = async () => {
    if (!apiKey) return;
    try {
      await saveKey.mutateAsync(apiKey);
      setApiKey('');
      setTestResult(null);
      toast({ title: 'Claude API key saved', variant: 'success' });
    } catch (err: any) {
      toast({ title: 'Failed to save key', description: err.message, variant: 'error' });
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              Claude API Key
            </CardTitle>
            <CardDescription>Used by every agent run in this workspace</CardDescription>
          </div>
          {!isLoading && (
            <div
              className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                configured
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}
            >
              {configured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {configured ? 'Configured' : 'Not configured'}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured && (
          <p className="text-sm text-warm-text-secondary">
            Agents can't run until an admin adds a Claude API key. Paste your key below, test it, and save.
            Get one at{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-warm-text"
            >
              console.anthropic.com
            </a>
            .
          </p>
        )}
        <div>
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder={configured ? '•••••••••••••••• (key is set — paste a new one to replace)' : 'sk-ant-...'}
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setTestResult(null);
            }}
            className="mt-1 font-mono text-sm"
            autoComplete="off"
          />
          {testResult && (
            <p
              className={`text-xs mt-2 flex items-center gap-1.5 ${
                testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
              }`}
            >
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {testResult.ok ? 'Valid key' : testResult.reason || 'Invalid key'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={!apiKey || testKey.isPending}
          >
            {testKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Test
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!apiKey || saveKey.isPending || (testResult !== null && !testResult.ok)}
          >
            {saveKey.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
