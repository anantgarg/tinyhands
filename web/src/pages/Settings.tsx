import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSettings, useUpdateSettings } from '@/api/settings';
import { toast } from '@/components/ui/use-toast';

export function Settings() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [general, setGeneral] = useState({
    workspaceName: '',
    defaultModel: 'claude-sonnet-4-20250514',
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
      setGeneral(settings.general);
      setDefaults(settings.defaults);
      setRateLimits(settings.rateLimits);
      setAlerts(settings.alerts);
    }
  }, [settings]);

  const handleSave = (section: string) => {
    const data = { general, defaults, rateLimits, alerts };
    updateSettings.mutate(
      { [section]: data[section as keyof typeof data] },
      { onSuccess: () => toast({ title: 'Settings saved', variant: 'success' }) },
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

  return (
    <div>
      <PageHeader title="Workspace Settings" description="Configure platform defaults and limits" />

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
                value={general.workspaceName}
                onChange={(e) => setGeneral({ ...general, workspaceName: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Default Model</Label>
              <Select
                value={general.defaultModel}
                onValueChange={(v) => setGeneral({ ...general, defaultModel: v })}
              >
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
          </div>
          <div className="max-w-xs">
            <Label>Daily Budget (USD)</Label>
            <Input
              type="number"
              step="0.01"
              value={general.dailyBudgetUsd}
              onChange={(e) => setGeneral({ ...general, dailyBudgetUsd: Number(e.target.value) })}
              className="mt-1"
            />
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
          <CardDescription>Default settings for new agents</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Default Access</Label>
              <Select
                value={defaults.defaultAccess}
                onValueChange={(v) => setDefaults({ ...defaults, defaultAccess: v })}
              >
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
              <Select
                value={defaults.writePolicy}
                onValueChange={(v) => setDefaults({ ...defaults, writePolicy: v })}
              >
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
          <div className="max-w-xs">
            <Label>Max Turns</Label>
            <Input
              type="number"
              value={defaults.maxTurns}
              onChange={(e) => setDefaults({ ...defaults, maxTurns: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={defaults.memoryEnabled}
              onCheckedChange={(checked) => setDefaults({ ...defaults, memoryEnabled: checked })}
            />
            <Label>Enable Memory by Default</Label>
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
              <Label>TPM Limit</Label>
              <Input
                type="number"
                value={rateLimits.tpmLimit}
                onChange={(e) => setRateLimits({ ...rateLimits, tpmLimit: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>RPM Limit</Label>
              <Input
                type="number"
                value={rateLimits.rpmLimit}
                onChange={(e) => setRateLimits({ ...rateLimits, rpmLimit: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Concurrent Runs Limit</Label>
              <Input
                type="number"
                value={rateLimits.concurrentRunsLimit}
                onChange={(e) => setRateLimits({ ...rateLimits, concurrentRunsLimit: Number(e.target.value) })}
                className="mt-1"
              />
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
                step="0.01"
                value={(alerts.errorRateThreshold * 100).toFixed(0)}
                onChange={(e) => setAlerts({ ...alerts, errorRateThreshold: Number(e.target.value) / 100 })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Cost Alert ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={alerts.costAlertThreshold}
                onChange={(e) => setAlerts({ ...alerts, costAlertThreshold: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Duration Alert (ms)</Label>
              <Input
                type="number"
                value={alerts.durationAlertThreshold}
                onChange={(e) => setAlerts({ ...alerts, durationAlertThreshold: Number(e.target.value) })}
                className="mt-1"
              />
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
