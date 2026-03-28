import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BookOpen, CheckCircle, XCircle, Wrench } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useUpgradeRequests, useApproveUpgrade, useDenyUpgrade, useAgents,
  useToolRequests, useApproveToolRequest, useDenyToolRequest,
  useFeatureRequests, useDismissFeatureRequest,
  usePendingCounts,
} from '@/api/agents';
import type { ToolRequest } from '@/api/agents';
import { useEvolutionProposals, useApproveProposal, useRejectProposal } from '@/api/evolution';
import { useKBEntries, useApproveKBEntry, useDeleteKBEntry } from '@/api/kb';
import { toast } from '@/components/ui/use-toast';

export function Requests() {
  const [activeTab, setActiveTab] = useState('upgrades');
  const { data: counts } = usePendingCounts();

  return (
    <div>
      <PageHeader title="Requests" description="Review pending requests across all agents" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upgrades">
            Upgrade Requests{counts?.upgrades ? ` (${counts.upgrades})` : ''}
          </TabsTrigger>
          <TabsTrigger value="approvals">Action Approvals</TabsTrigger>
          <TabsTrigger value="evolution">
            Evolution Proposals{counts?.evolutionProposals ? ` (${counts.evolutionProposals})` : ''}
          </TabsTrigger>
          <TabsTrigger value="tool-requests">
            Tool Requests{counts?.toolRequests ? ` (${counts.toolRequests})` : ''}
          </TabsTrigger>
          <TabsTrigger value="feature-requests">
            Feature Requests{counts?.featureRequests ? ` (${counts.featureRequests})` : ''}
          </TabsTrigger>
          <TabsTrigger value="kb">
            KB Contributions{counts?.kbContributions ? ` (${counts.kbContributions})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upgrades">
          <UpgradeRequestsTab />
        </TabsContent>
        <TabsContent value="approvals">
          <WriteApprovalsTab />
        </TabsContent>
        <TabsContent value="evolution">
          <EvolutionProposalsTab />
        </TabsContent>
        <TabsContent value="tool-requests">
          <ToolRequestsTab />
        </TabsContent>
        <TabsContent value="feature-requests">
          <FeatureRequestsTab />
        </TabsContent>
        <TabsContent value="kb">
          <KBContributionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UpgradeRequestsTab() {
  const { data: agents } = useAgents();
  const { data: requests, isLoading } = useUpgradeRequests();
  const approveUpgrade = useApproveUpgrade();
  const denyUpgrade = useDenyUpgrade();
  const [agentFilter, setAgentFilter] = useState('all');

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const pendingRequests = (requests ?? []).filter((r) => r.status === 'pending');

  const getAgentName = (agentId: string) => {
    const agent = (agents ?? []).find((a) => a.id === agentId);
    return agent?.name ?? agentId;
  };

  interface UpgradeRequestWithAgent {
    id: string;
    userId: string;
    displayName: string;
    reason: string;
    status: string;
    createdAt: string;
    agentId?: string;
  }

  const typedRequests = pendingRequests as UpgradeRequestWithAgent[];
  const filteredRequests = agentFilter === 'all'
    ? typedRequests
    : typedRequests.filter((r) => r.agentId === agentFilter);

  if (typedRequests.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No pending upgrade requests"
        description="When workspace members request elevated access to agents, their requests will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="w-40"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRequests.map((req) => (
              <TableRow key={req.id}>
                <TableCell className="font-medium">{req.displayName}</TableCell>
                <TableCell>
                  {req.agentId ? (
                    <Link to={`/agents/${req.agentId}`} className="text-brand hover:underline">
                      {getAgentName(req.agentId)}
                    </Link>
                  ) : (
                    <span className="text-warm-text-secondary">-</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[250px] truncate text-warm-text-secondary text-sm">
                  {req.reason}
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  {req.agentId && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => approveUpgrade.mutate({ agentId: req.agentId!, requestId: req.id })}
                        disabled={approveUpgrade.isPending}
                      >
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => denyUpgrade.mutate({ agentId: req.agentId!, requestId: req.id })}
                        disabled={denyUpgrade.isPending}
                      >
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Deny
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filteredRequests.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-warm-text-secondary">
                  No matching requests
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WriteApprovalsTab() {
  return (
    <EmptyState
      icon={Bell}
      title="Action approvals happen in Slack"
      description="When agents need approval before performing actions, they send a DM in Slack with approve/deny buttons. Real-time approvals are managed there."
    />
  );
}

function EvolutionProposalsTab() {
  const { data: agents } = useAgents();
  const { data, isLoading } = useEvolutionProposals({ status: 'pending' });
  const approveProposal = useApproveProposal();
  const rejectProposal = useRejectProposal();
  const [agentFilter, setAgentFilter] = useState('all');

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const proposals = data?.proposals ?? [];
  const filteredProposals = agentFilter === 'all'
    ? proposals
    : proposals.filter((p) => p.agentId === agentFilter);

  if (proposals.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No pending evolution proposals"
        description="When agents suggest improvements to themselves, their proposals will appear here for review."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {filteredProposals.map((proposal) => (
          <Card key={proposal.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{proposal.agentAvatar || '\uD83E\uDD16'}</span>
                  <div>
                    <CardTitle className="text-sm">{proposal.description}</CardTitle>
                    <p className="text-xs text-warm-text-secondary mt-0.5">
                      {proposal.agentName} - {formatDistanceToNow(new Date(proposal.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{(proposal.action || '').replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-warm-text-secondary mb-3">{proposal.description}</p>
              {proposal.diff && (
                <pre className="text-xs bg-warm-bg rounded-lg p-3 overflow-x-auto mb-3 font-mono">
                  {proposal.diff}
                </pre>
              )}
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    rejectProposal.mutate(proposal.id, {
                      onSuccess: () => toast({ title: 'Proposal rejected', variant: 'success' }),
                    });
                  }}
                  disabled={rejectProposal.isPending}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    approveProposal.mutate(proposal.id, {
                      onSuccess: () => toast({ title: 'Proposal approved', variant: 'success' }),
                    });
                  }}
                  disabled={approveProposal.isPending}
                >
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredProposals.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-warm-text-secondary">
              No matching proposals
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function formatAccessLevel(level: string): string {
  switch (level) {
    case 'read-write': return 'Can view & make changes';
    case 'read-only': return 'Can view data';
    default: return level;
  }
}

function ToolRequestsTab() {
  const { data: agents } = useAgents();
  const { data: requests, isLoading } = useToolRequests('pending');
  const approveRequest = useApproveToolRequest();
  const denyRequest = useDenyToolRequest();
  const [agentFilter, setAgentFilter] = useState('all');

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const pendingRequests = (requests ?? []) as ToolRequest[];
  const filteredRequests = agentFilter === 'all'
    ? pendingRequests
    : pendingRequests.filter((r) => r.agentId === agentFilter);

  if (pendingRequests.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title="No pending tool requests"
        description="When users request tool access for agents, their requests will appear here for review."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select value={agentFilter} onValueChange={setAgentFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Agents</SelectItem>
            {(agents ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requested By</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Tool</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="w-40"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRequests.map((req) => (
              <TableRow key={req.id}>
                <TableCell className="font-medium">{req.requestedByName || '\u2014'}</TableCell>
                <TableCell>
                  <Link to={`/agents/${req.agentId}`} className="text-brand hover:underline">
                    {req.agentName || req.agentId}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  {req.toolName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </TableCell>
                <TableCell>
                  <Badge variant={req.accessLevel === 'read-write' ? 'warning' : 'default'} className="text-xs">
                    {formatAccessLevel(req.accessLevel)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-warm-text-secondary text-sm">
                  {req.reason || '\u2014'}
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => approveRequest.mutate({ agentId: req.agentId, requestId: req.id })}
                      disabled={approveRequest.isPending}
                    >
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => denyRequest.mutate({ agentId: req.agentId, requestId: req.id })}
                      disabled={denyRequest.isPending}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Deny
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredRequests.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-warm-text-secondary">
                  No matching requests
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function FeatureRequestsTab() {
  const { data: requests, isLoading } = useFeatureRequests();
  const dismiss = useDismissFeatureRequest();

  if (isLoading) return <Skeleton className="h-[300px]" />;

  if (!requests || requests.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No feature requests"
        description="When users request agents that need unavailable tools or connections, those requests appear here."
      />
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {requests.map((req) => (
        <Card key={req.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{req.suggestedName || 'Unnamed Agent'}</CardTitle>
                <p className="text-xs text-warm-text-secondary mt-0.5">
                  Requested by {req.requestedByName} {formatDistanceToNow(new Date(req.createdAt), { addSuffix: true })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dismiss.mutate(req.id, {
                  onSuccess: () => toast({ title: 'Request dismissed', variant: 'success' }),
                })}
              >
                <XCircle className="mr-1 h-3.5 w-3.5" /> Dismiss
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs font-medium text-warm-text-secondary">Goal</p>
              <p className="text-sm">{req.goal}</p>
            </div>
            {req.blockers.length > 0 && (
              <div>
                <p className="text-xs font-medium text-warm-text-secondary">Blockers</p>
                <ul className="text-sm space-y-1 mt-1">
                  {req.blockers.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <Badge variant="warning" className="mt-0.5 text-[10px]">!</Badge>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {req.summary && (
              <div>
                <p className="text-xs font-medium text-warm-text-secondary">Summary</p>
                <p className="text-sm text-warm-text-secondary">{req.summary}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function KBContributionsTab() {
  const { data, isLoading } = useKBEntries({ approved: false });
  const approveEntry = useApproveKBEntry();
  const deleteEntry = useDeleteKBEntry();

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No pending KB contributions"
        description="When agents contribute knowledge base articles, they will appear here for review before being published."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-warm-border bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-40"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.title}</TableCell>
                <TableCell className="text-sm">{entry.category || '\u2014'}</TableCell>
                <TableCell className="text-sm text-warm-text-secondary">
                  {entry.sourceType || entry.sourceName || '\u2014'}
                </TableCell>
                <TableCell className="text-warm-text-secondary text-sm">
                  {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      onClick={() => approveEntry.mutate(entry.id, {
                        onSuccess: () => toast({ title: 'Entry approved', variant: 'success' }),
                      })}
                      disabled={approveEntry.isPending}
                    >
                      <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteEntry.mutate(entry.id, {
                        onSuccess: () => toast({ title: 'Entry rejected', variant: 'success' }),
                      })}
                      disabled={deleteEntry.isPending}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
