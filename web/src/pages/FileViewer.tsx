import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useUpdateDocument, useReplaceFile, useDocVersions, useRestoreVersion, type Document } from '@/api/docs';
import {
  ArrowLeft, Download, History, Upload, File,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface FileViewerProps {
  document: Document;
}

function getPreviewType(mimeType: string | null): 'image' | 'pdf' | 'text' | 'csv' | 'none' {
  if (!mimeType) return 'none';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/') || ['application/json', 'application/xml', 'application/yaml',
    'application/javascript', 'application/typescript', 'application/sql'].includes(mimeType)) return 'text';
  if (mimeType === 'text/csv') return 'csv';
  return 'none';
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileViewer({ document: doc }: FileViewerProps) {
  const navigate = useNavigate();
  const updateDoc = useUpdateDocument();
  const replaceFile = useReplaceFile();
  const { data: versions } = useDocVersions(doc.id);
  const restoreVersion = useRestoreVersion();

  const [title, setTitle] = useState(doc.title);
  const [agentEditable, setAgentEditable] = useState(doc.agentEditable);
  const [showVersions, setShowVersions] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(doc.version);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const previewType = getPreviewType(doc.mimeType);
  const downloadUrl = `/api/v1/docs/${doc.id}/download`;

  const handleToggleAgentEditable = useCallback((checked: boolean) => {
    setAgentEditable(checked);
    updateDoc.mutate(
      { id: doc.id, agentEditable: checked, expectedVersion: currentVersion },
      { onSuccess: () => setCurrentVersion(v => v + 1) },
    );
  }, [doc.id, currentVersion, updateDoc]);

  const handleReplace = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      alert('File must be under 25 MB');
      e.target.value = '';
      return;
    }
    replaceFile.mutate({ docId: doc.id, file }, {
      onError: (err: any) => alert(err.message || 'Replace failed'),
    });
    e.target.value = '';
  }, [doc.id, replaceFile]);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate('/documents')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Documents
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={agentEditable} onCheckedChange={handleToggleAgentEditable} id="agent-editable" />
            <Label htmlFor="agent-editable" className="text-sm">Allow agents to edit</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowVersions(true)}>
            <History className="mr-2 h-4 w-4" /> History
          </Button>
          <Button variant="outline" size="sm" onClick={() => replaceInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Replace
          </Button>
          <Button size="sm" onClick={() => window.open(downloadUrl, '_blank')}>
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
          <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplace} />
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
      />

      {/* Metadata */}
      <div className="flex gap-4 text-sm text-warm-text-secondary">
        <span>{doc.mimeType || 'Unknown type'}</span>
        <span>{formatFileSize(doc.fileSize)}</span>
        <span>Uploaded {new Date(doc.createdAt).toLocaleDateString()}</span>
        {doc.createdByType === 'agent' && <Badge variant="secondary">Created by agent</Badge>}
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-warm-border bg-warm-surface p-6 min-h-[400px] flex items-center justify-center">
        {previewType === 'image' && (
          <img
            src={downloadUrl}
            alt={doc.title}
            className="max-w-full max-h-[500px] object-contain"
          />
        )}
        {previewType === 'pdf' && (
          <iframe
            src={downloadUrl}
            className="w-full h-[600px] border-none"
            title={doc.title}
          />
        )}
        {previewType === 'text' && (
          <div className="w-full">
            <p className="text-sm text-warm-text-secondary mb-2">
              Text file preview — <a href={downloadUrl} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">download full file</a>
            </p>
            <pre className="bg-gray-50 rounded-lg p-4 text-sm overflow-auto max-h-[500px] font-mono">
              {/* Text content would be fetched separately */}
              Preview available after download.
            </pre>
          </div>
        )}
        {previewType === 'none' && (
          <div className="text-center space-y-4">
            <File className="h-16 w-16 text-warm-text-secondary mx-auto" />
            <p className="text-warm-text-secondary">No preview available for this file type.</p>
            <Button onClick={() => window.open(downloadUrl, '_blank')}>
              <Download className="mr-2 h-4 w-4" /> Download to view
            </Button>
          </div>
        )}
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
                <Button variant="outline" size="sm" onClick={async () => {
                  await restoreVersion.mutateAsync({ docId: doc.id, version: v.version });
                  setShowVersions(false);
                  window.location.reload();
                }}>
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
