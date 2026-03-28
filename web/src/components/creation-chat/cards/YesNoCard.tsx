import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface YesNoCardProps {
  question?: string;
  description?: string;
  yesLabel?: string;
  noLabel?: string;
  defaultValue?: boolean;
  onSubmit: (value: boolean) => void;
  disabled?: boolean;
}

export function YesNoCard({
  question,
  description,
  yesLabel = 'Yes',
  noLabel = 'No',
  defaultValue,
  onSubmit,
  disabled,
}: YesNoCardProps) {
  const [selected, setSelected] = useState<boolean | null>(defaultValue ?? null);

  if (disabled && selected !== null) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-2 text-sm text-warm-text">
        <Check className="h-4 w-4 shrink-0 text-brand" />
        <span className="font-medium">{selected ? yesLabel : noLabel}</span>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {question && <p className="text-sm font-medium text-warm-text mb-1">{question}</p>}
      {description && <p className="text-xs text-warm-text-secondary mb-2">{description}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setSelected(true);
            onSubmit(true);
          }}
          className={cn(
            'flex-1 rounded-btn border px-4 py-2 text-sm font-semibold transition-all',
            selected === true
              ? 'border-brand bg-brand-light/30 text-brand'
              : 'border-warm-border bg-white text-warm-text hover:border-warm-text-secondary/30',
          )}
        >
          {yesLabel}
        </button>
        <button
          onClick={() => {
            setSelected(false);
            onSubmit(false);
          }}
          className={cn(
            'flex-1 rounded-btn border px-4 py-2 text-sm font-semibold transition-all',
            selected === false
              ? 'border-brand bg-brand-light/30 text-brand'
              : 'border-warm-border bg-white text-warm-text hover:border-warm-text-secondary/30',
          )}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}
