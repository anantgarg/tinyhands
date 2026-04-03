import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  useUpdateDocument, useCreateSheetTab,
  useUpdateCells, useDocVersions, useRestoreVersion,
  type Document, type SheetTab,
} from '@/api/docs';
import {
  ArrowLeft, Plus, History, Download, Clock,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface SheetEditorProps {
  document: Document & { tabs?: SheetTab[] };
}

/**
 * Spreadsheet editor using a native HTML table with editable cells.
 * This is a lightweight implementation — can be upgraded to Univer later.
 */
export function SheetEditor({ document: doc }: SheetEditorProps) {
  const navigate = useNavigate();
  const updateDoc = useUpdateDocument();
  const updateCells = useUpdateCells();
  const createTab = useCreateSheetTab();
  const { data: versions } = useDocVersions(doc.id);
  const restoreVersion = useRestoreVersion();

  const [activeTabId, setActiveTabId] = useState<string>(doc.tabs?.[0]?.id || '');
  const [agentEditable, setAgentEditable] = useState(doc.agentEditable);
  const [title, setTitle] = useState(doc.title);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [currentVersion, setCurrentVersion] = useState(doc.version);

  const activeTab = doc.tabs?.find(t => t.id === activeTabId) || doc.tabs?.[0];
  const cellData = activeTab?.data || {};

  // Compute grid dimensions
  const maxRow = Math.max(20, activeTab?.rowCount || 0, ...Object.keys(cellData).map(k => {
    const m = k.match(/(\d+)$/);
    return m ? parseInt(m[1]) : 0;
  }));
  const maxCol = Math.max(10, activeTab?.colCount || 0, ...Object.keys(cellData).map(k => {
    const m = k.match(/^([A-Z]+)/);
    if (!m) return 0;
    let col = 0;
    for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
    return col;
  }));

  const displayRows = Math.min(maxRow + 5, 100);
  const displayCols = Math.min(maxCol + 3, 26);

  const colLetter = (idx: number): string => String.fromCharCode(64 + idx);

  const saveCellData = useCallback(async (ref: string, value: string) => {
    if (!activeTab) return;

    let cellValue: any;
    if (value.trim() === '') {
      cellValue = null; // server treats null as deletion
    } else {
      const num = Number(value);
      cellValue = { v: (!isNaN(num) && value.trim() !== '') ? num : value };
    }

    try {
      setSaving(true);
      await updateCells.mutateAsync({
        docId: doc.id,
        tabId: activeTab.id,
        cells: { [ref]: cellValue },
      });
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }, [activeTab, doc.id, updateCells]);

  const handleCellBlur = useCallback(() => {
    if (editingCell) {
      saveCellData(editingCell, cellValue);
      setEditingCell(null);
    }
  }, [editingCell, cellValue, saveCellData]);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [handleCellBlur]);

  const handleToggleAgentEditable = useCallback((checked: boolean) => {
    setAgentEditable(checked);
    updateDoc.mutate(
      { id: doc.id, agentEditable: checked, expectedVersion: currentVersion },
      { onSuccess: () => setCurrentVersion(v => v + 1) },
    );
  }, [doc.id, currentVersion, updateDoc]);

  const handleAddTab = useCallback(async () => {
    const result = await createTab.mutateAsync({ docId: doc.id, name: `Sheet${(doc.tabs?.length || 0) + 1}` });
    setActiveTabId((result as any).id);
  }, [doc.id, doc.tabs, createTab]);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/documents')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Documents
        </Button>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-warm-text-secondary flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {saving && <Badge variant="secondary" className="text-xs">Saving...</Badge>}
          <div className="flex items-center gap-2">
            <Switch checked={agentEditable} onCheckedChange={handleToggleAgentEditable} id="agent-editable" />
            <Label htmlFor="agent-editable" className="text-sm">Allow agents to edit</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowVersions(true)}>
            <History className="mr-2 h-4 w-4" /> History
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/v1/docs/${doc.id}/export?format=csv&tabId=${activeTabId}`, '_blank')}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Title */}
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== doc.title) {
            updateDoc.mutate(
              { id: doc.id, title, expectedVersion: currentVersion },
              { onSuccess: () => setCurrentVersion(v => v + 1) },
            );
          }
        }}
        className="text-2xl font-bold border-none shadow-none px-0 focus-visible:ring-0"
        placeholder="Untitled Spreadsheet"
      />

      {/* Spreadsheet Grid */}
      <div className="rounded-lg border border-warm-border overflow-auto max-h-[600px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px] bg-warm-surface sticky left-0 z-10 text-center">#</TableHead>
              {Array.from({ length: displayCols }, (_, i) => (
                <TableHead key={i} className="min-w-[100px] bg-warm-surface text-center">
                  {colLetter(i + 1)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: displayRows }, (_, rowIdx) => (
              <TableRow key={rowIdx}>
                <TableCell className="bg-warm-surface sticky left-0 z-10 text-center text-xs text-warm-text-secondary font-mono">
                  {rowIdx + 1}
                </TableCell>
                {Array.from({ length: displayCols }, (_, colIdx) => {
                  const ref = colLetter(colIdx + 1) + (rowIdx + 1);
                  const cell = cellData[ref];
                  const isEditing = editingCell === ref;

                  return (
                    <TableCell
                      key={colIdx}
                      className="p-0 border-r border-warm-border"
                      onClick={() => {
                        setEditingCell(ref);
                        setCellValue(cell?.v != null ? String(cell.v) : '');
                      }}
                    >
                      {isEditing ? (
                        <input
                          className="w-full h-full px-2 py-1 text-sm border-none outline-none bg-blue-50"
                          value={cellValue}
                          onChange={(e) => setCellValue(e.target.value)}
                          onBlur={handleCellBlur}
                          onKeyDown={handleCellKeyDown}
                          autoFocus
                        />
                      ) : (
                        <div className="px-2 py-1 text-sm min-h-[28px] cursor-cell">
                          {cell?.v != null ? String(cell.v) : ''}
                        </div>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-t border-warm-border pt-2">
        {doc.tabs?.map(tab => (
          <Button
            key={tab.id}
            variant={tab.id === activeTabId ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.name}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={handleAddTab}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Version History Dialog */}
      <Dialog open={showVersions} onOpenChange={setShowVersions}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {versions?.length === 0 && (
              <p className="text-sm text-warm-text-secondary py-4 text-center">No previous versions.</p>
            )}
            {versions?.map((v) => (
              <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-warm-border">
                <div>
                  <p className="text-sm font-medium">Version {v.version}</p>
                  <p className="text-xs text-warm-text-secondary">
                    {v.changeSummary || 'No description'} &middot; {new Date(v.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await restoreVersion.mutateAsync({ docId: doc.id, version: v.version });
                    setShowVersions(false);
                    window.location.reload();
                  }}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
