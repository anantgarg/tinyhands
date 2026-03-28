import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

interface MultiChoiceCardProps {
  options: Option[];
  defaultValue?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function MultiChoiceCard({ options, defaultValue, onSubmit, disabled }: MultiChoiceCardProps) {
  const [selected, setSelected] = useState(defaultValue || '');

  if (disabled) {
    const chosen = options.find(o => o.value === selected);
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-2 text-sm text-warm-text">
        <Check className="h-4 w-4 shrink-0 text-brand" />
        <span className="font-medium">{chosen?.label || selected}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setSelected(opt.value)}
          className={cn(
            'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
            selected === opt.value
              ? 'border-brand bg-brand-light/30'
              : 'border-warm-border bg-white hover:border-warm-text-secondary/30',
          )}
        >
          <div
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
              selected === opt.value ? 'border-brand bg-brand' : 'border-warm-border',
            )}
          >
            {selected === opt.value && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-warm-text">{opt.label}</span>
              {opt.recommended && (
                <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-medium text-brand">
                  Recommended
                </span>
              )}
            </div>
            {opt.description && (
              <p className="mt-0.5 text-xs text-warm-text-secondary">{opt.description}</p>
            )}
          </div>
        </button>
      ))}
      <button
        onClick={() => selected && onSubmit(selected)}
        disabled={!selected}
        className="mt-1 rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
