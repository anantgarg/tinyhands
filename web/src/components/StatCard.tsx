import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  icon?: LucideIcon;
  color?: 'blue' | 'green' | 'amber' | 'red';
}

const colorMap = {
  blue: { bg: 'bg-blue-50/80', icon: 'text-blue-600' },
  green: { bg: 'bg-emerald-50/80', icon: 'text-emerald-600' },
  amber: { bg: 'bg-amber-50/80', icon: 'text-amber-600' },
  red: { bg: 'bg-red-50/80', icon: 'text-red-600' },
};

export function StatCard({ label, value, trend, icon: Icon, color = 'blue' }: StatCardProps) {
  const colors = colorMap[color];

  return (
    <div className="rounded-card border border-warm-border bg-white px-5 py-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-warm-text-secondary">{label}</p>
          <p className="mt-1 text-2xl font-extrabold text-warm-text tracking-tight">{value}</p>
          {trend && (
            <p className={cn('mt-0.5 text-xs font-medium', trend.startsWith('+') ? 'text-emerald-600' : 'text-red-600')}>
              {trend}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('rounded-lg p-2', colors.bg)}>
            <Icon className={cn('h-5 w-5', colors.icon)} />
          </div>
        )}
      </div>
    </div>
  );
}
