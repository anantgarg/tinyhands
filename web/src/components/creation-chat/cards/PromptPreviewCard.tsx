import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react';

interface PromptPreviewCardProps {
  prompt: string;
  onSubmit: (response: { action: 'approve' | 'edit' }) => void;
  disabled?: boolean;
}

export function PromptPreviewCard({ prompt, onSubmit, disabled }: PromptPreviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [chosenAction, setChosenAction] = useState<'approve' | 'edit' | null>(null);

  if (disabled) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-2 text-sm text-warm-text">
        {chosenAction === 'edit' ? (
          <>
            <Pencil className="h-4 w-4 shrink-0 text-brand" />
            <span className="font-medium">Editing instructions...</span>
          </>
        ) : (
          <>
            <Check className="h-4 w-4 shrink-0 text-brand" />
            <span className="font-medium">Instructions reviewed</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-warm-border bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-warm-text hover:bg-warm-bg transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-warm-text-secondary" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-warm-text-secondary" />
        )}
        <span className="font-medium">View agent instructions</span>
      </button>

      {expanded && (
        <div className="border-t border-warm-border px-3 py-2">
          <div className="max-h-60 overflow-y-auto rounded-md bg-gray-50 p-3">
            {prompt ? (
              <pre className="whitespace-pre-wrap text-xs font-mono text-warm-text leading-relaxed">
                {prompt}
              </pre>
            ) : (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-4/5" />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 border-t border-warm-border px-3 py-3">
        <button
          onClick={() => {
            setChosenAction('approve');
            onSubmit({ action: 'approve' });
          }}
          disabled={!prompt}
          className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {prompt ? 'Looks good' : (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading...
            </span>
          )}
        </button>
        <button
          onClick={() => {
            setChosenAction('edit');
            onSubmit({ action: 'edit' });
          }}
          disabled={!prompt}
          className={cn(
            'rounded-btn border border-warm-border bg-white px-4 py-2 text-sm font-medium text-warm-text transition-colors hover:bg-warm-bg disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          Let me edit
        </button>
      </div>
    </div>
  );
}
