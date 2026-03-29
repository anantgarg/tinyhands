import { useState, useMemo, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Check, Search, ChevronDown, Info, RefreshCw } from 'lucide-react';

interface DropdownOption {
  value: string;
  label: string;
  isPrivate?: boolean;
}

interface DropdownCardProps {
  options: DropdownOption[];
  searchable?: boolean;
  placeholder?: string;
  defaultValue?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  helpText?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function DropdownCard({
  options,
  searchable = true,
  placeholder = 'Select an option...',
  defaultValue,
  onSubmit,
  disabled,
  helpText,
  onRefresh,
  refreshing,
}: DropdownCardProps) {
  const [selected, setSelected] = useState(defaultValue || '');
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (disabled) {
    const chosen = options.find((o) => o.value === selected);
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-brand/30 bg-brand-light/30 px-3 py-2 text-sm text-warm-text">
        <Check className="h-4 w-4 shrink-0 text-brand" />
        <span className="font-medium">{chosen?.label || selected}</span>
      </div>
    );
  }

  const selectedLabel = options.find((o) => o.value === selected)?.label;

  return (
    <div className="mt-2 space-y-2" ref={containerRef}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'flex w-full items-center justify-between rounded-btn border px-3 py-2 text-sm transition-colors',
            isOpen ? 'border-brand ring-2 ring-brand/20' : 'border-warm-border',
            selected ? 'text-warm-text' : 'text-warm-text-secondary',
          )}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-warm-border bg-white shadow-overlay">
            {searchable && (
              <div className="flex items-center gap-2 border-b border-warm-border px-3 py-2">
                <Search className="h-3.5 w-3.5 text-warm-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="flex-1 bg-transparent text-sm text-warm-text outline-none placeholder:text-warm-text-secondary/50"
                  autoFocus
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-xs text-warm-text-secondary">No results found</p>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSelected(opt.value);
                      setIsOpen(false);
                      setSearch('');
                      onSubmit(opt.value);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                      selected === opt.value
                        ? 'bg-brand-light/30 text-brand font-medium'
                        : 'text-warm-text hover:bg-warm-bg',
                    )}
                  >
                    {selected === opt.value && <Check className="h-3.5 w-3.5 shrink-0" />}
                    <span className={cn(selected !== opt.value && 'ml-5.5')}>
                      {opt.isPrivate ? '🔒 ' : ''}{opt.label}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {helpText && (
        <div className="flex items-start gap-2 text-xs text-warm-text-secondary">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{helpText}</span>
        </div>
      )}
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-brand hover:text-brand/80 transition-colors"
          disabled={refreshing}
          type="button"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
          Refresh channels
        </button>
      )}

      <button
        onClick={() => selected && onSubmit(selected)}
        disabled={!selected}
        className="rounded-btn bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue
      </button>
    </div>
  );
}
