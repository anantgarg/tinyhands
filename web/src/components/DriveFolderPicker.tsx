import { useState } from 'react';
import { ChevronRight, Folder, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveFolders } from '@/api/kb';

interface DriveFolderPickerProps {
  value: string;
  valueName?: string;
  onChange: (id: string, name: string) => void;
  placeholder?: string;
  helpText?: string;
}

export function DriveFolderPicker({ value, valueName, onChange, placeholder, helpText }: DriveFolderPickerProps) {
  const [browsing, setBrowsing] = useState(false);
  const [currentParent, setCurrentParent] = useState('root');
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const { data, isLoading, isError } = useDriveFolders(browsing ? currentParent : null);

  const navigateInto = (folderId: string, folderName: string) => {
    setCurrentParent(folderId);
    setBreadcrumbs((prev) => [...prev, { id: folderId, name: folderName }]);
  };

  const navigateTo = (idx: number) => {
    const target = breadcrumbs[idx];
    setCurrentParent(target.id);
    setBreadcrumbs((prev) => prev.slice(0, idx + 1));
  };

  if (!browsing) {
    const hasValue = !!(value && valueName);
    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasValue ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warm-bg px-2.5 py-1 text-sm">
              <Folder className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span className="truncate max-w-[240px]">{valueName}</span>
              <button
                type="button"
                className="ml-1 text-warm-text-secondary hover:text-warm-text"
                onClick={() => onChange('', '')}
                aria-label="Clear folder"
              >
                ×
              </button>
            </span>
          ) : (
            <span className="text-sm text-warm-text-secondary">{placeholder || 'All folders (no restriction)'}</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setBrowsing(true)}>
            <Folder className="mr-1.5 h-3.5 w-3.5" /> {hasValue ? 'Change' : 'Browse'}
          </Button>
        </div>
        {helpText && <p className="text-xs text-warm-text-secondary mt-1">{helpText}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warm-border">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-warm-border text-xs text-warm-text-secondary overflow-x-auto">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button className="hover:text-warm-text underline-offset-2 hover:underline" onClick={() => navigateTo(i)}>
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Folder list */}
      <div className="max-h-[200px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-warm-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading folders...
          </div>
        ) : isError ? (
          <p className="text-sm text-red-500 text-center py-4">Failed to load folders. Is your Google account connected?</p>
        ) : (data?.folders ?? []).length === 0 ? (
          <p className="text-sm text-warm-text-secondary text-center py-4">No subfolders here</p>
        ) : (
          (data?.folders ?? []).map((folder) => (
            <div
              key={folder.id}
              className="flex items-center justify-between px-3 py-2 hover:bg-warm-bg cursor-pointer group"
            >
              <button
                className="flex items-center gap-2 text-sm flex-1 text-left"
                onClick={() => navigateInto(folder.id, folder.name)}
              >
                <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs opacity-0 group-hover:opacity-100 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(folder.id, folder.name);
                  setBrowsing(false);
                }}
              >
                Select
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Select current folder / cancel */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-warm-border">
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setBrowsing(false)}>Cancel</Button>
        {currentParent !== 'root' && (
          <Button
            size="sm"
            className="text-xs"
            onClick={() => {
              const current = breadcrumbs[breadcrumbs.length - 1];
              onChange(current.id, current.name);
              setBrowsing(false);
            }}
          >
            Use this folder
          </Button>
        )}
      </div>
    </div>
  );
}
