import { useState } from 'react';
import { Lightbulb, Check, X, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEvolutionProposals, useApproveProposal, useRejectProposal } from '@/api/evolution';
import { toast } from '@/components/ui/use-toast';

function humanizeType(type: unknown): string {
  if (!type || typeof type !== 'string') return 'Unknown';
  const map: Record<string, string> = {
    prompt_refinement: 'Prompt Refinement',
    tool_suggestion: 'Tool Suggestion',
    behavior_change: 'Behavior Change',
  };
  return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}

export function Evolution() {
  const [status, setStatus] = useState<string>('pending');
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useEvolutionProposals({ status: status === 'all' ? undefined : status, page, limit: 20 });
  const approveProposal = useApproveProposal();
  const rejectProposal = useRejectProposal();

  const proposals = data?.proposals ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const handleApprove = (id: string) => {
    approveProposal.mutate(id, {
      onSuccess: () => toast({ title: 'Proposal approved', variant: 'success' }),
    });
  };

  const handleReject = (id: string) => {
    rejectProposal.mutate(id, {
      onSuccess: () => toast({ title: 'Proposal rejected', variant: 'success' }),
    });
  };

  return (
    <div>
      <PageHeader title="Evolution Proposals" description="Review agent self-improvement suggestions">
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[200px]" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-red-500">
            <AlertCircle className="h-5 w-5 mx-auto mb-2" />
            Failed to load evolution proposals
          </CardContent>
        </Card>
      ) : proposals.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No proposals"
          description={status === 'pending' ? 'No pending proposals to review. Agents will create proposals as they identify improvements.' : 'No proposals found with this filter'}
        />
      ) : (
        <div className="space-y-4">
          {proposals.map((proposal) => (
            <Card key={proposal.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{proposal.agentAvatar ?? '\uD83E\uDD16'}</span>
                    <div>
                      <CardTitle className="text-base">{proposal.title ?? 'Untitled Proposal'}</CardTitle>
                      <CardDescription>
                        {proposal.agentName ?? 'Unknown Agent'} &middot; {humanizeType(proposal.type)} &middot; Confidence: {Math.round((proposal.confidence ?? 0) * 100)}%
                      </CardDescription>
                    </div>
                  </div>
                  <Badge
                    variant={
                      proposal.status === 'pending'
                        ? 'warning'
                        : proposal.status === 'approved'
                        ? 'success'
                        : 'danger'
                    }
                  >
                    {proposal.status ?? 'unknown'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-warm-text-secondary mb-4">{proposal.description ?? ''}</p>

                {proposal.diff && (
                  <div className="mb-4">
                    <p className="text-xs font-medium text-warm-text-secondary mb-2">Proposed changes:</p>
                    <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap text-xs bg-warm-sidebar rounded-btn p-3 font-mono">
                      {proposal.diff}
                    </pre>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs text-warm-text-secondary">
                    {fmtRelative(proposal.createdAt)}
                    {proposal.reviewedBy ? ` \u2014 reviewed by ${proposal.reviewedBy}` : ''}
                  </span>
                  {proposal.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => handleApprove(proposal.id)} disabled={approveProposal.isPending}>
                        <Check className="mr-1 h-3 w-3" />
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(proposal.id)} disabled={rejectProposal.isPending}>
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-warm-text-secondary">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
