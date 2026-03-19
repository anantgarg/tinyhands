import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  icon?: LucideIcon;
  color?: 'blue' | 'green' | 'amber' | 'red';
}

const colorMap = {
  blue: { bg: 'bg-blue-50', icon: 'text-blue-600', trend: 'text-blue-600' },
  green: { bg: 'bg-green-50', icon: 'text-green-600', trend: 'text-green-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600', trend: 'text-amber-600' },
  red: { bg: 'bg-red-50', icon: 'text-red-600', trend: 'text-red-600' },
};

export function StatCard({ label, value, trend, icon: Icon, color = 'blue' }: StatCardProps) {
  const colors = colorMap[color];
  const isPositive = trend?.startsWith('+');

  return (
    <Card className={cn('relative overflow-hidden', colors.bg, 'border-transparent')}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-warm-text-secondary">{label}</p>
            <p className="mt-1 text-2xl font-bold text-warm-text">{value}</p>
            {trend && (
              <p className={cn('mt-1 text-xs font-medium', isPositive ? 'text-green-600' : 'text-red-600')}>
                {trend}
              </p>
            )}
          </div>
          {Icon && (
            <div className={cn('rounded-btn p-2', colors.bg)}>
              <Icon className={cn('h-5 w-5', colors.icon)} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
