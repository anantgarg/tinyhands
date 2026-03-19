import { GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';

export function Workflows() {
  return (
    <div>
      <PageHeader title="Workflows" description="Multi-step automation workflows" />

      <EmptyState
        icon={GitBranch}
        title="Workflows — Coming Soon"
        description="Chain multiple agent actions into automated sequences with conditions and checkpoints. This feature is under development."
      />
    </div>
  );
}
