import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-warm-border bg-white">
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="rounded-2xl bg-warm-bg p-5 mb-5">
          <Icon className="h-8 w-8 text-warm-text-secondary" />
        </div>
        <h3 className="text-lg font-bold text-warm-text">{title}</h3>
        <p className="mt-1.5 max-w-sm text-sm text-warm-text-secondary leading-relaxed">{description}</p>
        {action && (
          <Button className="mt-6" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
