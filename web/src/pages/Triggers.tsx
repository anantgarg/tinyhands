import { useState } from 'react';
import { Zap, Plus, Search, Trash2, MoreVertical, Power, PowerOff, MessageSquare, CalendarClock, Webhook, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTriggers, useCreateTrigger, useUpdateTrigger, useDeleteTrigger } from '@/api/triggers';
import { useAgents } from '@/api/agents';
import { toast } from '@/components/ui/use-toast';

function parseTriggerConfig(config: Record<string, unknown> | null | undefined): string {
  if (!config) return '\u2014';
  if (config.channelId) return `Channel: ${config.channelId}${config.mentionsOnly ? ' (mentions only)' : ' (all messages)'}`;
  if (config.cron) return `${config.cron}${config.timezone ? ` (${config.timezone})` : ''}`;
  if (config.url) return String(config.url);
  const str = JSON.stringify(config);
  return str === '{}' ? '\u2014' : str;
}

function humanizeCron(cron: string | undefined): string {
  if (!cron) return '\u2014';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, , , dow] = parts;
  const dayMap: Record<string, string> = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat', '7': 'Sun' };
  const dowStr = dow === '*'
    ? 'every day'
    : dow === '1-5'
    ? 'weekdays'
    : dow === '0,6'
    ? 'weekends'
    : dow.split(',').map((d) => dayMap[d] ?? d).join(', ');
  if (hour === '*' && min === '*') return 'Every minute';
  if (hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
  return `${hour}:${min.padStart(2, '0')} ${dowStr}`;
}

function triggerTypeLabel(type: string): string {
  const map: Record<string, string> = {
    slack_channel: 'Slack Channel',
    schedule: 'Schedule',
    webhook: 'Webhook',
    linear: 'Linear',
    zendesk: 'Zendesk',
    intercom: 'Intercom',
  };
  return map[type] ?? type;
}

export function Triggers() {
  const { data: triggers, isLoading, isError } = useTriggers();
  const { data: agents } = useAgents();
  const createTrigger = useCreateTrigger();
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();

  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newAgentId, setNewAgentId] = useState('');
  const [newType, setNewType] = useState('schedule');
  const [newConfig, setNewConfig] = useState('{}');

  const allTriggers = triggers ?? [];
  const filtered = allTriggers.filter((t) => {
    if (search && !(t.agentName ?? '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const channelTriggers = filtered.filter((t) => t.type === 'slack_channel');
  const scheduleTriggers = filtered.filter((t) => t.type === 'schedule');
  const eventTriggers = filtered.filter((t) => !['slack_channel', 'schedule'].includes(t.type));

  const handleCreate = () => {
    if (!newAgentId) {
      toast({ title: 'Select an agent', variant: 'error' });
      return;
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(newConfig);
    } catch {
      toast({ title: 'Invalid JSON config', variant: 'error' });
      return;
    }
    createTrigger.mutate(
      { agentId: newAgentId, type: newType, config },
      {
        onSuccess: () => {
          toast({ title: 'Trigger created', variant: 'success' });
          setShowCreate(false);
          setNewAgentId('');
          setNewConfig('{}');
        },
      },
    );
  };

  const handleToggle = (id: string, enabled: boolean) => {
    updateTrigger.mutate(
      { id, enabled: !enabled },
      { onSuccess: () => toast({ title: `Trigger ${enabled ? 'disabled' : 'enabled'}`, variant: 'success' }) },
    );
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this trigger?')) {
      deleteTrigger.mutate(id, {
        onSuccess: () => toast({ title: 'Trigger deleted', variant: 'success' }),
      });
    }
  };

  const renderTriggerActions = (trigger: typeof allTriggers[0]) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleToggle(trigger.id, trigger.enabled)}>
          {trigger.enabled ? (
            <><PowerOff className="mr-2 h-4 w-4" /> Disable</>
          ) : (
            <><Power className="mr-2 h-4 w-4" /> Enable</>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(trigger.id)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      <PageHeader title="Triggers" description="Manage agent activation triggers">
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Trigger
        </Button>
      </PageHeader>

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-text-secondary" />
          <Input
            placeholder="Search by agent name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-[300px]" />
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load triggers
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No triggers found"
          description="Create triggers to automatically activate agents based on Slack messages, schedules, or external events"
          action={{ label: 'Create Trigger', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="space-y-8">
          {/* Channel Triggers */}
          {channelTriggers.length > 0 && (
            <section>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-brand" />
                    <div>
                      <CardTitle className="text-base">Channel Triggers</CardTitle>
                      <CardDescription>Triggers that fire based on Slack messages</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Triggered</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {channelTriggers.map((trigger) => {
                        const cfg = trigger.config ?? {};
                        return (
                          <TableRow key={trigger.id}>
                            <TableCell className="font-medium">{trigger.agentName ?? '\u2014'}</TableCell>
                            <TableCell className="font-mono text-xs">{(cfg.channelId as string) ?? '\u2014'}</TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {cfg.mentionsOnly ? 'Mentions only' : 'All messages'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={trigger.enabled ? 'success' : 'secondary'}>
                                {trigger.enabled ? 'Enabled' : 'Disabled'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-warm-text-secondary text-xs">
                              {trigger.lastTriggeredAt
                                ? formatDistanceToNow(new Date(trigger.lastTriggeredAt), { addSuffix: true })
                                : 'Never'}
                            </TableCell>
                            <TableCell>{renderTriggerActions(trigger)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Scheduled Triggers */}
          {scheduleTriggers.length > 0 && (
            <section>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5 text-brand" />
                    <div>
                      <CardTitle className="text-base">Scheduled Triggers</CardTitle>
                      <CardDescription>Triggers that fire on a cron schedule</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Timezone</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Triggered</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheduleTriggers.map((trigger) => {
                        const cfg = trigger.config ?? {};
                        return (
                          <TableRow key={trigger.id}>
                            <TableCell className="font-medium">{trigger.agentName ?? '\u2014'}</TableCell>
                            <TableCell>
                              <div>
                                <p className="text-sm">{humanizeCron(cfg.cron as string | undefined)}</p>
                                <p className="text-xs text-warm-text-secondary font-mono">{(cfg.cron as string) ?? ''}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-warm-text-secondary text-xs">
                              {(cfg.timezone as string) ?? 'UTC'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={trigger.enabled ? 'success' : 'secondary'}>
                                {trigger.enabled ? 'Enabled' : 'Disabled'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-warm-text-secondary text-xs">
                              {trigger.lastTriggeredAt
                                ? formatDistanceToNow(new Date(trigger.lastTriggeredAt), { addSuffix: true })
                                : 'Never'}
                            </TableCell>
                            <TableCell>{renderTriggerActions(trigger)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Event Triggers */}
          {eventTriggers.length > 0 && (
            <section>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Webhook className="h-5 w-5 text-brand" />
                    <div>
                      <CardTitle className="text-base">Event Triggers</CardTitle>
                      <CardDescription>Webhook, Linear, Zendesk, and Intercom triggers</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Config</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Triggered</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {eventTriggers.map((trigger) => (
                        <TableRow key={trigger.id}>
                          <TableCell className="font-medium">{trigger.agentName ?? '\u2014'}</TableCell>
                          <TableCell>
                            <Badge variant="default">{triggerTypeLabel(trigger.type)}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate text-warm-text-secondary text-xs">
                            {parseTriggerConfig(trigger.config)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={trigger.enabled ? 'success' : 'secondary'}>
                              {trigger.enabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-warm-text-secondary text-xs">
                            {trigger.lastTriggeredAt
                              ? formatDistanceToNow(new Date(trigger.lastTriggeredAt), { addSuffix: true })
                              : 'Never'}
                          </TableCell>
                          <TableCell>{renderTriggerActions(trigger)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Trigger</DialogTitle>
            <DialogDescription>Set up a new trigger to activate an agent</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Agent</Label>
              <Select value={newAgentId} onValueChange={setNewAgentId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.avatarEmoji ?? ''} {a.name ?? 'Unnamed'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack_channel">Slack Channel</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="zendesk">Zendesk</SelectItem>
                  <SelectItem value="intercom">Intercom</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-warm-text-secondary mt-1">
                {newType === 'slack_channel' && 'Trigger when messages are posted in a Slack channel'}
                {newType === 'schedule' && 'Trigger on a cron schedule (e.g. every weekday at 9am)'}
                {newType === 'webhook' && 'Trigger via an external webhook URL'}
                {newType === 'linear' && 'Trigger on Linear issue events'}
                {newType === 'zendesk' && 'Trigger on Zendesk ticket events'}
                {newType === 'intercom' && 'Trigger on Intercom conversation events'}
              </p>
            </div>
            <div>
              <Label>Config (JSON)</Label>
              <Input
                value={newConfig}
                onChange={(e) => setNewConfig(e.target.value)}
                placeholder={
                  newType === 'schedule'
                    ? '{"cron": "0 9 * * 1-5", "timezone": "America/New_York"}'
                    : newType === 'slack_channel'
                    ? '{"channelId": "C...", "mentionsOnly": false}'
                    : '{}'
                }
                className="mt-1 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createTrigger.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
