import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const FREQUENCIES = [
  { value: '0 * * * *', label: 'Every hour' },
  { value: '0 */2 * * *', label: 'Every 2 hours' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 9 * * *', label: 'Daily (9 AM)' },
  { value: '0 9 * * 1', label: 'Weekly (Monday 9 AM)' },
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

interface ScheduleCardProps {
  defaultFrequency?: string;
  defaultTimezone?: string;
  onSubmit: (cron: string, timezone: string) => void;
  disabled?: boolean;
}

export function ScheduleCard({ defaultFrequency, defaultTimezone, onSubmit, disabled }: ScheduleCardProps) {
  const [frequency, setFrequency] = useState(defaultFrequency || '0 9 * * *');
  const [timezone, setTimezone] = useState(defaultTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

  if (disabled) {
    const freqLabel = FREQUENCIES.find((f) => f.value === frequency)?.label || frequency;
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-2 text-sm text-warm-text">
        <Check className="h-4 w-4 shrink-0 text-brand" />
        <span className="font-medium">{freqLabel} ({timezone})</span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div>
        <p className="text-xs font-medium text-warm-text-secondary mb-1.5">Frequency</p>
        <div className="space-y-1">
          {FREQUENCIES.map((freq) => (
            <button
              key={freq.value}
              onClick={() => setFrequency(freq.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-all',
                frequency === freq.value
                  ? 'border-brand bg-brand-light/30 font-medium text-warm-text'
                  : 'border-warm-border bg-white text-warm-text hover:border-warm-text-secondary/30',
              )}
            >
              <div
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  frequency === freq.value ? 'border-brand bg-brand' : 'border-warm-border',
                )}
              >
                {frequency === freq.value && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
              </div>
              {freq.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-warm-text-secondary mb-1.5">Timezone</p>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-btn border border-warm-border bg-white px-3 py-2 text-sm text-warm-text outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onSubmit(frequency, timezone)}
        className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        Set Schedule
      </button>
    </div>
  );
}
