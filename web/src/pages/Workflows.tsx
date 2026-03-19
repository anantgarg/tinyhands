import { GitBranch, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useWorkflowDefinitions, useWorkflowRuns, useResolveWorkflowStep } from '@/api/workflows';
import { toast } from '@/components/ui/use-toast';

function fmtUserId(createdBy: unknown): string {
  if (!createdBy || typeof createdBy !== 'string') return '\u2014';
  if (createdBy.startsWith('U')) return `@${createdBy}`;
  return createdBy;
}

function fmtRelative(v: unknown): string {
  if (!v) return '\u2014';
  try {
    return formatDistanceToNow(new Date(v as string), { addSuffix: true });
  } catch {
    return '\u2014';
  }
}

export function Workflows() {
  const { data: definitions, isLoading: defsLoading, isError: defsError } = useWorkflowDefinitions();
  const { data: runs, isLoading: runsLoading, isError: runsError } = useWorkflowRuns();
  const resolveStep = useResolveWorkflowStep();

  const handleResolve = (runId: string, stepId: string, action: string) => {
    resolveStep.mutate(
      { runId, stepId, action },
      { onSuccess: () => toast({ title: 'Step resolved', variant: 'success' }) },
    );
  };

  return (
    <div>
      <PageHeader title="Workflows" description="Multi-step automation workflows" />

      {/* Definitions */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Workflow Definitions</h2>
        {defsLoading ? (
          <Skeleton className="h-[200px]" />
        ) : defsError ? (
          <Card>
            <CardContent className="py-8 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Failed to load workflow definitions
            </CardContent>
          </Card>
        ) : (definitions ?? []).length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No workflows defined"
            description="Workflows let you chain multiple agent actions into automated sequences with conditions and human checkpoints. Create workflows via Slack to get started."
          />
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Steps</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(definitions ?? []).map((def) => (
                    <TableRow key={def.id}>
                      <TableCell className="font-medium">{def.name ?? 'Unnamed'}</TableCell>
                      <TableCell className="text-warm-text-secondary max-w-[300px] truncate">
                        {def.description ?? '\u2014'}
                      </TableCell>
                      <TableCell>{def.steps?.length ?? 0}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">{fmtUserId(def.createdBy)}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {fmtRelative(def.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

      {/* Active Runs */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Active Runs</h2>
        {runsLoading ? (
          <Skeleton className="h-[200px]" />
        ) : runsError ? (
          <Card>
            <CardContent className="py-8 text-center text-red-500">
              <AlertCircle className="h-5 w-5 mx-auto mb-2" />
              Failed to load workflow runs
            </CardContent>
          </Card>
        ) : (runs ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-warm-text-secondary">
              No active workflow runs. Runs will appear here when workflows are triggered.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current Step</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runs ?? []).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">{run.definitionName ?? '\u2014'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.status === 'completed'
                              ? 'success'
                              : run.status === 'failed'
                              ? 'danger'
                              : run.status === 'paused'
                              ? 'warning'
                              : 'default'
                          }
                        >
                          {run.status ?? 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-warm-text-secondary">{run.currentStep ?? '\u2014'}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {fmtRelative(run.startedAt)}
                      </TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {run.completedAt ? fmtRelative(run.completedAt) : '\u2014'}
                      </TableCell>
                      <TableCell>
                        {run.status === 'paused' && run.currentStep && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              onClick={() => handleResolve(run.id, run.currentStep, 'approve')}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResolve(run.id, run.currentStep, 'reject')}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
