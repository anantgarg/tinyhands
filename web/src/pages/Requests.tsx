import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle, XCircle, Wrench } from 'lucide-react';
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
import { useUpgradeRequests, useApproveUpgrade, useDenyUpgrade, useAgents } from '@/api/agents';
import { useEvolutionProposals, useApproveProposal, useRejectProposal } from '@/api/evolution';
import { toast } from '@/components/ui/use-toast';

export function Requests() {
  const [activeTab, setActiveTab] = useState('upgrades');

  return (
    <div>
      <PageHeader title="Requests" description="Review pending requests across all agents" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upgrades">Upgrade Requests</TabsTrigger>
          <TabsTrigger value="approvals">Action Approvals</TabsTrigger>
          <TabsTrigger value="evolution">Evolution Proposals</TabsTrigger>
          <TabsTrigger value="tool-requests">Tool Requests</TabsTrigger>
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

      <div className="rounded-card border border-warm-border bg-white">
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
                    <CardTitle className="text-sm">{proposal.title}</CardTitle>
                    <p className="text-xs text-warm-text-secondary mt-0.5">
                      {proposal.agentName} - {formatDistanceToNow(new Date(proposal.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{proposal.type}</Badge>
                  <Badge variant="warning">{Math.round(proposal.confidence * 100)}% confidence</Badge>
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

function ToolRequestsTab() {
  return (
    <EmptyState
      icon={Wrench}
      title="No tool requests"
      description="Tool access requests from agents will appear here."
    />
  );
}
