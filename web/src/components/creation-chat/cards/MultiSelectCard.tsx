import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface MultiSelectOption {
  value: string;
  label: string;
  icon?: string;
  hasWrite?: boolean;
  readToolName?: string;
  writeToolName?: string;
}

interface MultiSelectCardProps {
  options: MultiSelectOption[];
  defaultValues?: string[];
  onSubmit: (values: string[]) => void;
  disabled?: boolean;
}

export function MultiSelectCard({ options, defaultValues, onSubmit, disabled }: MultiSelectCardProps) {
  const [selected, setSelected] = useState<string[]>(defaultValues || []);

  const toggle = (toolName: string, alsoAdd?: string) => {
    setSelected((prev) => {
      if (prev.includes(toolName)) {
        return prev.filter((t) => t !== toolName);
      }
      const next = [...prev, toolName];
      if (alsoAdd && !prev.includes(alsoAdd)) next.push(alsoAdd);
      return next;
    });
  };

  const remove = (toolName: string) => {
    setSelected((prev) => prev.filter((t) => t !== toolName));
  };

  if (disabled) {
    const labels = options
      .filter((o) => selected.includes(o.readToolName || o.value) || selected.includes(o.writeToolName || ''))
      .map((o) => {
        const hasRead = selected.includes(o.readToolName || o.value);
        const hasWrite = selected.includes(o.writeToolName || '');
        return `${o.label}${hasWrite ? ' (read + write)' : hasRead ? ' (read)' : ''}`;
      });

    if (labels.length === 0) {
      return (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-warm-border bg-warm-bg px-3 py-2 text-sm text-warm-text-secondary">
          No services selected
        </div>
      );
    }

    return (
      <div className="mt-2 space-y-1">
        {labels.map((label) => (
          <div
            key={label}
            className="flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-1.5 text-sm text-warm-text"
          >
            <Check className="h-3.5 w-3.5 shrink-0 text-brand" />
            <span className="font-medium">{label}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {options.length === 0 ? (
        <p className="text-xs text-warm-text-secondary py-2">
          No connected services available. You can add them later from the agent settings.
        </p>
      ) : (
        <div className="space-y-1.5">
          {options.map((opt) => {
            const readTool = opt.readToolName || opt.value;
            const writeTool = opt.writeToolName;
            const hasRead = selected.includes(readTool);
            const hasWrite = writeTool ? selected.includes(writeTool) : false;
            const isActive = hasRead || hasWrite;

            return (
              <div
                key={opt.value}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  isActive ? 'border-brand/40 bg-brand-light/20' : 'border-warm-border bg-white',
                )}
              >
                <p className="text-sm font-medium text-warm-text mb-2">{opt.label}</p>
                <div className="flex gap-2">
                  <label
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                      hasRead || hasWrite
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80 cursor-pointer',
                      hasWrite ? 'opacity-70' : 'cursor-pointer',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={hasRead || hasWrite}
                      disabled={hasWrite}
                      onChange={() => {
                        if (hasWrite) return;
                        if (hasRead) remove(readTool);
                        else toggle(readTool);
                      }}
                      className="h-3 w-3"
                    />
                    Can view data
                  </label>
                  {writeTool && (
                    <label
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs cursor-pointer transition-colors',
                        hasWrite
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-warm-bg text-warm-text-secondary hover:bg-warm-bg/80',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={hasWrite}
                        onChange={() => {
                          if (hasWrite) {
                            remove(writeTool);
                          } else {
                            toggle(writeTool, readTool);
                          }
                        }}
                        className="h-3 w-3"
                      />
                      Can make changes
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={() => onSubmit(selected)}
        className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        {selected.length > 0 ? 'Continue' : 'Skip'}
      </button>
    </div>
  );
}
