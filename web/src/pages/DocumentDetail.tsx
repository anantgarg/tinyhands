import { useParams, useNavigate } from 'react-router-dom';
import { useDocument } from '@/api/docs';
import { DocEditor } from './DocEditor';
import { SheetEditor } from './SheetEditor';
import { FileViewer } from './FileViewer';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

/**
 * Smart router that renders the right editor/viewer based on document type.
 */
export function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: doc, isLoading, error } = useDocument(id || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-warm-text-secondary">
        Loading document...
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/documents')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Documents
        </Button>
        <div className="flex items-center justify-center py-20 text-warm-text-secondary">
          Document not found.
        </div>
      </div>
    );
  }

  switch (doc.type) {
    case 'doc':
      return <DocEditor document={doc} />;
    case 'sheet':
      return <SheetEditor document={doc} />;
    case 'file':
      return <FileViewer document={doc} />;
    default:
      return <div>Unknown document type: {doc.type}</div>;
  }
}
