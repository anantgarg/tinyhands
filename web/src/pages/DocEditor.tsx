import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useUpdateDocument, useDocVersions, useRestoreVersion, type Document } from '@/api/docs';
import { slateJsonToMarkdown, markdownToSlateJson } from '@/lib/doc-convert';
import { ArrowLeft, Save, History, Download, Clock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface DocEditorProps {
  document: Document;
}

/**
 * Rich text document editor.
 * Uses the existing RichTextEditor component (TipTap-based).
 * Content is stored as Slate JSON but edited via TipTap (markdown intermediary).
 * Auto-saves with debounce.
 */
export function DocEditor({ document: doc }: DocEditorProps) {
  const navigate = useNavigate();
  const updateDoc = useUpdateDocument();
  const { data: versions } = useDocVersions(doc.id);
  const restoreVersion = useRestoreVersion();

  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(() => {
    // Convert Slate JSON to markdown for the RichTextEditor
    if (doc.content) {
      return slateJsonToMarkdown(doc.content);
    }
    return '';
  });
  const [agentEditable, setAgentEditable] = useState(doc.agentEditable);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(doc.version);

  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const agentEditableRef = useRef(agentEditable);
  const versionRef = useRef(currentVersion);
  titleRef.current = title;
  contentRef.current = content;
  agentEditableRef.current = agentEditable;
  versionRef.current = currentVersion;

  // Auto-save with 2s debounce — uses refs to avoid stale closures
  const scheduleAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await updateDoc.mutateAsync({
          id: doc.id,
          title: titleRef.current,
          content: markdownToSlateJson(contentRef.current),
          agentEditable: agentEditableRef.current,
          expectedVersion: versionRef.current,
        });
        setCurrentVersion(v => v + 1);
        versionRef.current = versionRef.current + 1;
        setLastSaved(new Date());
      } catch (err: any) {
        if (err.message?.includes('409') || err.message?.includes('modified')) {
          alert('This document was modified elsewhere. Please refresh the page.');
        }
      } finally {
        setSaving(false);
      }
    }, 2000);
  }, [doc.id, updateDoc]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const handleContentChange = useCallback((value: string) => {
    setContent(value);
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const handleTitleChange = useCallback((value: string) => {
    setTitle(value);
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const handleToggleAgentEditable = useCallback((checked: boolean) => {
    setAgentEditable(checked);
    // Save immediately for toggle changes
    updateDoc.mutate({
      id: doc.id,
      agentEditable: checked,
      expectedVersion: currentVersion,
    });
    setCurrentVersion(v => v + 1);
  }, [doc.id, currentVersion, updateDoc]);

  const handleExport = useCallback((format: string) => {
    window.open(`/api/v1/docs/${doc.id}/export?format=${format}`, '_blank');
  }, [doc.id]);

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
          {saving && (
            <Badge variant="secondary" className="text-xs">Saving...</Badge>
          )}
          <div className="flex items-center gap-2">
            <Switch
              checked={agentEditable}
              onCheckedChange={handleToggleAgentEditable}
              id="agent-editable"
            />
            <Label htmlFor="agent-editable" className="text-sm">Allow agents to edit</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowVersions(true)}>
            <History className="mr-2 h-4 w-4" /> History
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('markdown')}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* Title */}
      <Input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        className="text-2xl font-bold border-none shadow-none px-0 focus-visible:ring-0"
        placeholder="Untitled Document"
      />

      {/* Editor */}
      <div className="min-h-[500px] rounded-lg border border-warm-border bg-white p-6">
        <RichTextEditor
          value={content}
          onChange={handleContentChange}
          placeholder="Start writing..."
        />
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

