import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
          <TabsTrigger value="approvals">Write Approvals</TabsTrigger>
          <TabsTrigger value="evolution">Evolution Proposals</TabsTrigger>
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
      </Tabs>
    </div>
  );
}

function UpgradeRequestsTab() {
  const { data: agents } = useAgents();
  const { data: requests, isLoading } = useUpgradeRequests();
  const approveUpgrade = useApproveUpgrade();
  const denyUpgrade = useDenyUpgrade();

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const pendingRequests = (requests ?? []).filter((r) => r.status === 'pending');

  const getAgentName = (agentId: string) => {
    const agent = (agents ?? []).find((a) => a.id === agentId);
    return agent?.name ?? agentId;
  };

  // We need agentId from the requests. Since the generic endpoint may not include it,
  // we handle both shaped data gracefully.
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
          {typedRequests.map((req) => (
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
        </TableBody>
      </Table>
    </div>
  );
}

function WriteApprovalsTab() {
  // Write approvals are handled in real-time via Slack DMs. The web dashboard shows a placeholder.
  return (
    <EmptyState
      icon={Bell}
      title="Write approvals happen in Slack"
      description="When agents need write approval, they send a DM in Slack with approve/deny buttons. Real-time approvals are managed there."
    />
  );
}

function EvolutionProposalsTab() {
  const { data, isLoading } = useEvolutionProposals({ status: 'pending' });
  const approveProposal = useApproveProposal();
  const rejectProposal = useRejectProposal();

  if (isLoading) return <Skeleton className="h-[300px]" />;

  const proposals = data?.proposals ?? [];

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
    <div className="space-y-3">
      {proposals.map((proposal) => (
        <Card key={proposal.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{proposal.agentAvatar || '🤖'}</span>
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
    </div>
  );
}
