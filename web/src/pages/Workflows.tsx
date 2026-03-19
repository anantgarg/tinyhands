import { GitBranch } from 'lucide-react';
import { format } from 'date-fns';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useWorkflowDefinitions, useWorkflowRuns, useResolveWorkflowStep } from '@/api/workflows';
import { toast } from '@/components/ui/use-toast';

export function Workflows() {
  const { data: definitions, isLoading: defsLoading } = useWorkflowDefinitions();
  const { data: runs, isLoading: runsLoading } = useWorkflowRuns();
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
        ) : (definitions ?? []).length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title="No workflows defined"
            description="Workflows allow you to create multi-step automations with branching logic"
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
                      <TableCell className="font-medium">{def.name}</TableCell>
                      <TableCell className="text-warm-text-secondary max-w-[300px] truncate">
                        {def.description}
                      </TableCell>
                      <TableCell>{def.steps.length}</TableCell>
                      <TableCell className="text-warm-text-secondary">{def.createdBy}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {format(new Date(def.updatedAt), 'MMM d, yyyy')}
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
        ) : (runs ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-warm-text-secondary">
              No active workflow runs
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
                      <TableCell className="font-medium">{run.definitionName}</TableCell>
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
                          {run.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-warm-text-secondary">{run.currentStep}</TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {format(new Date(run.startedAt), 'MMM d, HH:mm')}
                      </TableCell>
                      <TableCell className="text-warm-text-secondary text-xs">
                        {run.completedAt ? format(new Date(run.completedAt), 'MMM d, HH:mm') : '-'}
                      </TableCell>
                      <TableCell>
                        {run.status === 'paused' && (
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
