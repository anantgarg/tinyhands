import { useState } from 'react';
import { Zap, Plus, Search, Trash2, MoreVertical, Power, PowerOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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

export function Triggers() {
  const { data: triggers, isLoading } = useTriggers();
  const { data: agents } = useAgents();
  const createTrigger = useCreateTrigger();
  const updateTrigger = useUpdateTrigger();
  const deleteTrigger = useDeleteTrigger();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newAgentId, setNewAgentId] = useState('');
  const [newType, setNewType] = useState('schedule');
  const [newConfig, setNewConfig] = useState('{}');

  const filtered = (triggers ?? []).filter((t) => {
    if (search && !t.agentName.toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;
    return true;
  });

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
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="slack_channel">Slack Channel</SelectItem>
            <SelectItem value="linear">Linear</SelectItem>
            <SelectItem value="zendesk">Zendesk</SelectItem>
            <SelectItem value="intercom">Intercom</SelectItem>
            <SelectItem value="webhook">Webhook</SelectItem>
            <SelectItem value="schedule">Schedule</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-[300px]" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="No triggers found"
          description="Create triggers to automatically activate agents based on events"
          action={{ label: 'Create Trigger', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
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
                {filtered.map((trigger) => (
                  <TableRow key={trigger.id}>
                    <TableCell className="font-medium">{trigger.agentName}</TableCell>
                    <TableCell>
                      <Badge variant="default">{trigger.type}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-warm-text-secondary font-mono text-xs">
                      {JSON.stringify(trigger.config)}
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
                    <TableCell>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
                    <SelectItem key={a.id} value={a.id}>{a.avatarEmoji} {a.name}</SelectItem>
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
                  <SelectItem value="linear">Linear</SelectItem>
                  <SelectItem value="zendesk">Zendesk</SelectItem>
                  <SelectItem value="intercom">Intercom</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="schedule">Schedule</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Config (JSON)</Label>
              <Input
                value={newConfig}
                onChange={(e) => setNewConfig(e.target.value)}
                placeholder='{"cron": "0 9 * * 1-5"}'
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
