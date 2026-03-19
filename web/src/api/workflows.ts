import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: { id: string; name: string; type: string; config: Record<string, unknown> }[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowRun {
  id: string;
  definitionId: string;
  definitionName: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  currentStep: string;
  context: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
}

interface CreateWorkflowPayload {
  name: string;
  description: string;
  steps: { name: string; type: string; config: Record<string, unknown> }[];
}

export function useWorkflowDefinitions() {
  return useQuery<WorkflowDefinition[]>({
    queryKey: ['workflows', 'definitions'],
    queryFn: () => api.get('/workflows/definitions'),
  });
}

export function useCreateWorkflowDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkflowPayload) => api.post('/workflows/definitions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', 'definitions'] }),
  });
}

export function useWorkflowRuns() {
  return useQuery<WorkflowRun[]>({
    queryKey: ['workflows', 'runs'],
    queryFn: () => api.get('/workflows/runs'),
  });
}

export function useResolveWorkflowStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, stepId, action, data }: { runId: string; stepId: string; action: string; data?: Record<string, unknown> }) =>
      api.post(`/workflows/runs/${runId}/steps/${stepId}/resolve`, { action, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows', 'runs'] }),
  });
}
