import { useEffect, useState } from 'react';
import { ChevronRight, Folder, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveSheets } from '@/api/database';

interface Props {
  value: { id: string; name: string } | null;
  onChange: (sel: { id: string; name: string } | null) => void;
}

// Drive picker that lists folders + Google Sheets and lets the admin click
// into folders or click a sheet to select it. Matches the look of
// DriveFolderPicker so admins don't have to relearn anything; the only
// difference is that leaves are spreadsheets, not folders.
export function DriveSheetPicker({ value, onChange }: Props) {
  const [browsing, setBrowsing] = useState(false);
  const [parent, setParent] = useState<string>('root');
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }]);
  const { data, isLoading, isError, error } = useDriveSheets(browsing ? parent : null);

  // The connection may be scoped to a single folder (Tools → My connections →
  // Restrict Drive access). When the response surfaces that, treat the
  // restricted folder as the top of the breadcrumb — the user can't navigate
  // up to "My Drive" because the connection literally cannot see it.
  useEffect(() => {
    if (data?.restrictedRootId && crumbs.length === 1 && crumbs[0].id === 'root') {
      setCrumbs([{ id: data.restrictedRootId, name: data.restrictedRootName || 'Restricted folder' }]);
      setParent(data.restrictedRootId);
    }
  }, [data?.restrictedRootId, data?.restrictedRootName, crumbs]);

  const navigateInto = (id: string, name: string) => {
    setParent(id);
    setCrumbs((p) => [...p, { id, name }]);
  };

  const navigateTo = (idx: number) => {
    const target = crumbs[idx];
    setParent(target.id);
    setCrumbs((p) => p.slice(0, idx + 1));
  };

  if (!browsing) {
    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          {value ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warm-bg px-2.5 py-1 text-sm">
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="truncate max-w-[260px]">{value.name}</span>
              <button
                type="button"
                className="ml-1 text-warm-text-secondary hover:text-warm-text"
                onClick={() => onChange(null)}
                aria-label="Clear sheet"
              >×</button>
            </span>
          ) : (
            <span className="text-sm text-warm-text-secondary">No spreadsheet picked yet</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setBrowsing(true)}>
            <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> {value ? 'Change' : 'Pick a sheet'}
          </Button>
        </div>
        <p className="text-xs text-warm-text-secondary mt-1">
          Browse your Google Drive and pick a Google Sheet. The table will re-sync from it every 5 minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-warm-border">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-warm-border text-xs text-warm-text-secondary overflow-x-auto">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button className="hover:text-warm-text underline-offset-2 hover:underline" onClick={() => navigateTo(i)}>
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div className="max-h-[260px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-warm-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : isError ? (
          <p className="text-sm text-red-500 text-center py-4 px-3">
            {(error as any)?.message || 'Failed to load. Is your Google account connected?'}
          </p>
        ) : (
          <>
            {(data?.folders ?? []).map((f) => (
              <button
                key={f.id}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-warm-bg text-left text-sm"
                onClick={() => navigateInto(f.id, f.name)}
              >
                <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <ChevronRight className="h-3.5 w-3.5 text-warm-text-secondary" />
              </button>
            ))}
            {(data?.sheets ?? []).map((s) => (
              <button
                key={s.id}
                className="flex items-center gap-2 w-full px-3 py-2 hover:bg-warm-bg text-left text-sm"
                onClick={() => { onChange({ id: s.id, name: s.name }); setBrowsing(false); }}
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="truncate flex-1">{s.name}</span>
                <span className="text-xs text-warm-text-secondary">Select</span>
              </button>
            ))}
            {(data?.folders ?? []).length === 0 && (data?.sheets ?? []).length === 0 && (
              <p className="text-sm text-warm-text-secondary text-center py-4">
                No folders or Google Sheets here.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-end px-3 py-2 border-t border-warm-border">
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setBrowsing(false)}>Cancel</Button>
      </div>
    </div>
  );
}
