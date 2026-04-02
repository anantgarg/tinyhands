import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getSessionUser } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import {
  createDocument, getDocument, listDocuments, updateDocument,
  archiveDocument, deleteDocument, searchDocuments, getDocumentStats,
  listVersions, getVersion, restoreVersion,
  createSheetTab, getSheetTabs, updateSheetTab, deleteSheetTab,
  reorderSheetTabs, updateCells, appendRows,
  uploadFile, getFileDownload, updateFileContent,
  MAX_FILE_SIZE,
} from '../../modules/docs';
import { slateJsonToMarkdown, cellDataToCsv, csvToCellData, markdownToSlateJson } from '../../modules/docs/convert';
import { logger } from '../../utils/logger';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });

// ── Stats ──

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const stats = await getDocumentStats(workspaceId);
    res.json(stats);
  } catch (err: any) {
    logger.error('Document stats error', { error: err.message });
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ── Document CRUD ──

// GET /docs — List documents
router.get('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const result = await listDocuments(workspaceId, {
      type: req.query.type as any,
      agentId: req.query.agentId as string,
      createdBy: req.query.createdBy as string,
      tags: req.query.tags ? (req.query.tags as string).split(',') : undefined,
      search: req.query.search as string,
      includeArchived: req.query.includeArchived === 'true',
      page: parseInt(req.query.page as string) || 1,
      limit: parseInt(req.query.limit as string) || 20,
    });
    res.json(result);
  } catch (err: any) {
    logger.error('List documents error', { error: err.message });
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// GET /docs/search — Full-text search
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const q = req.query.q as string;
    if (!q) { res.status(400).json({ error: 'q (query) is required' }); return; }
    const results = await searchDocuments(workspaceId, q, parseInt(req.query.limit as string) || 20);
    res.json(results);
  } catch (err: any) {
    logger.error('Search documents error', { error: err.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

// POST /docs — Create document
router.post('/', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { type, title, description, content, tags, agentId } = req.body;
    if (!type || !title) { res.status(400).json({ error: 'type and title are required' }); return; }
    if (title.length > 500) { res.status(400).json({ error: 'Title must be under 500 characters' }); return; }
    if (description && description.length > 2000) { res.status(400).json({ error: 'Description must be under 2000 characters' }); return; }

    let docContent = content;
    if (type === 'doc' && typeof content === 'string') {
      docContent = markdownToSlateJson(content);
    }

    const doc = await createDocument(workspaceId, {
      type,
      title,
      description,
      content: docContent,
      tags,
      agentId,
      createdBy: userId,
      createdByType: 'user',
    });
    res.status(201).json(doc);
  } catch (err: any) {
    logger.error('Create document error', { error: err.message });
    res.status(400).json({ error: "Couldn't create the document. Please try again." });
  }
});

// POST /docs/upload — Upload file (multipart)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);

    // Check for multer-processed file
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const doc = await uploadFile(workspaceId, {
      title: file.originalname || 'Untitled',
      mimeType: file.mimetype || 'application/octet-stream',
      data: file.buffer,
      createdBy: userId,
      createdByType: 'user',
      tags: req.body.tags ? JSON.parse(req.body.tags) : [],
    });
    res.status(201).json(doc);
  } catch (err: any) {
    logger.error('Upload file error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't upload the file." });
  }
});

// POST /docs/import-csv — Import CSV as sheet
router.post('/import-csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const csvText = file.buffer.toString('utf-8');
    const cellData = csvToCellData(csvText);
    const title = req.body.title || file.originalname?.replace(/\.csv$/i, '') || 'Imported Sheet';

    const doc = await createDocument(workspaceId, {
      type: 'sheet',
      title,
      createdBy: userId,
      createdByType: 'user',
    });

    // Update the auto-created first tab with the CSV data
    const tabs = await getSheetTabs(workspaceId, doc.id);
    if (tabs.length > 0) {
      await updateSheetTab(workspaceId, tabs[0].id, { data: cellData });
    }

    res.status(201).json(doc);
  } catch (err: any) {
    logger.error('Import CSV error', { error: err.message });
    res.status(400).json({ error: "Couldn't import the CSV file." });
  }
});

// POST /docs/import-docx — Import DOCX as doc
router.post('/import-docx', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    let text: string;
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
    } catch {
      res.status(400).json({ error: 'Failed to parse DOCX file' });
      return;
    }

    const content = markdownToSlateJson(text);
    const title = req.body.title || file.originalname?.replace(/\.docx?$/i, '') || 'Imported Document';

    const doc = await createDocument(workspaceId, {
      type: 'doc',
      title,
      content,
      createdBy: userId,
      createdByType: 'user',
    });

    res.status(201).json(doc);
  } catch (err: any) {
    logger.error('Import DOCX error', { error: err.message });
    res.status(400).json({ error: "Couldn't import the DOCX file." });
  }
});

// GET /docs/:id — Get document
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const doc = await getDocument(workspaceId, req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

    // Include sheet tabs for sheet type
    let tabs;
    if (doc.type === 'sheet') {
      tabs = await getSheetTabs(workspaceId, doc.id);
    }

    res.json({ ...doc, tabs });
  } catch (err: any) {
    logger.error('Get document error', { error: err.message });
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// GET /docs/:id/download — Download file
router.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { data, mimeType, title } = await getFileDownload(workspaceId, req.params.id as string);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  } catch (err: any) {
    logger.error('Download file error', { error: err.message });
    res.status(err.message === 'Document not found' ? 404 : 500).json({ error: err.message });
  }
});

// GET /docs/:id/export — Export document as markdown, HTML, or CSV
router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const format = req.query.format as string;
    const doc = await getDocument(workspaceId, req.params.id as string);
    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }

    if (doc.type === 'doc') {
      if (format === 'markdown' || format === 'md') {
        const md = doc.content ? slateJsonToMarkdown(doc.content) : '';
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.title)}.md"`);
        res.send(md);
      } else if (format === 'html') {
        // Simple HTML export from Slate JSON
        const md = doc.content ? slateJsonToMarkdown(doc.content) : '';
        const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title></head><body><pre>${escapeHtml(md)}</pre></body></html>`;
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.title)}.html"`);
        res.send(html);
      } else {
        res.status(400).json({ error: 'Supported formats: markdown, html' });
      }
    } else if (doc.type === 'sheet') {
      if (format === 'csv') {
        const tabId = req.query.tabId as string;
        const tabs = await getSheetTabs(workspaceId, doc.id);
        const tab = tabId ? tabs.find(t => t.id === tabId) : tabs[0];
        if (!tab) { res.status(404).json({ error: 'Sheet tab not found' }); return; }
        const csv = cellDataToCsv(tab.data);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.title)} - ${encodeURIComponent(tab.name)}.csv"`);
        res.send(csv);
      } else {
        res.status(400).json({ error: 'Supported formats: csv' });
      }
    } else {
      res.status(400).json({ error: 'Export not supported for file type' });
    }
  } catch (err: any) {
    logger.error('Export error', { error: err.message });
    res.status(500).json({ error: 'Export failed' });
  }
});

// POST /docs/:id/replace — Replace file content
router.post('/:id/replace', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const file = (req as any).file;
    if (!file) { res.status(400).json({ error: 'File is required' }); return; }
    const doc = await updateFileContent(workspaceId, req.params.id as string, file.buffer, userId);
    res.json(doc);
  } catch (err: any) {
    logger.error('Replace file error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't replace the file." });
  }
});

// PATCH /docs/:id — Update document
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const { title, description, content, tags, agentEditable, expectedVersion } = req.body;
    if (!expectedVersion) { res.status(400).json({ error: 'expectedVersion is required' }); return; }
    if (title && title.length > 500) { res.status(400).json({ error: 'Title must be under 500 characters' }); return; }
    if (description && description.length > 2000) { res.status(400).json({ error: 'Description must be under 2000 characters' }); return; }

    const doc = await updateDocument(workspaceId, req.params.id as string, {
      title, description, content, tags, agentEditable,
      updatedBy: userId,
      expectedVersion,
    });
    res.json(doc);
  } catch (err: any) {
    if (err.message === 'VERSION_CONFLICT') {
      res.status(409).json({ error: 'Document was modified by someone else. Please refresh and try again.', currentVersion: err.currentVersion });
    } else {
      logger.error('Update document error', { error: err.message });
      res.status(400).json({ error: err.message || "Couldn't update the document." });
    }
  }
});

// DELETE /docs/:id — Archive (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    await archiveDocument(workspaceId, req.params.id as string);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Archive document error', { error: err.message });
    res.status(400).json({ error: "Couldn't archive the document." });
  }
});

// DELETE /docs/:id/permanent — Hard delete (admin-only)
router.delete('/:id/permanent', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    await deleteDocument(workspaceId, req.params.id as string);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete document error', { error: err.message });
    res.status(400).json({ error: "Couldn't delete the document." });
  }
});

// ── Version History ──

router.get('/:id/versions', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const versions = await listVersions(workspaceId, req.params.id as string);
    res.json(versions);
  } catch (err: any) {
    logger.error('List versions error', { error: err.message });
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

router.get('/:id/versions/:version', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const version = await getVersion(workspaceId, req.params.id as string, parseInt(req.params.version as string));
    if (!version) { res.status(404).json({ error: 'Version not found' }); return; }
    res.json(version);
  } catch (err: any) {
    logger.error('Get version error', { error: err.message });
    res.status(500).json({ error: 'Failed to get version' });
  }
});

router.post('/:id/versions/:version/restore', async (req: Request, res: Response) => {
  try {
    const { workspaceId, userId } = getSessionUser(req);
    const doc = await restoreVersion(workspaceId, req.params.id as string, parseInt(req.params.version as string), userId);
    res.json(doc);
  } catch (err: any) {
    logger.error('Restore version error', { error: err.message });
    res.status(400).json({ error: err.message || 'Restore failed' });
  }
});

// ── Sheet Tabs ──

router.get('/:id/tabs', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const tabs = await getSheetTabs(workspaceId, req.params.id as string);
    res.json(tabs);
  } catch (err: any) {
    logger.error('List tabs error', { error: err.message });
    res.status(500).json({ error: 'Failed to list tabs' });
  }
});

router.post('/:id/tabs', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const tab = await createSheetTab(workspaceId, req.params.id as string, req.body.name || 'New Sheet');
    res.status(201).json(tab);
  } catch (err: any) {
    logger.error('Create tab error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't create tab." });
  }
});

router.patch('/:id/tabs/:tabId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const tab = await updateSheetTab(workspaceId, req.params.tabId as string, req.body);
    res.json(tab);
  } catch (err: any) {
    logger.error('Update tab error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't update tab." });
  }
});

router.delete('/:id/tabs/:tabId', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    await deleteSheetTab(workspaceId, req.params.tabId as string);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Delete tab error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't delete tab." });
  }
});

router.post('/:id/tabs/reorder', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    await reorderSheetTabs(workspaceId, req.params.id as string, req.body.tabIds);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('Reorder tabs error', { error: err.message });
    res.status(400).json({ error: "Couldn't reorder tabs." });
  }
});

router.patch('/:id/tabs/:tabId/cells', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { cells } = req.body;
    if (!cells || typeof cells !== 'object') { res.status(400).json({ error: 'cells object is required' }); return; }
    if (Object.keys(cells).length > 10000) { res.status(400).json({ error: 'Too many cells in a single update (max 10,000)' }); return; }
    const cellsPayloadSize = Buffer.byteLength(JSON.stringify(cells), 'utf-8');
    if (cellsPayloadSize > 10 * 1024 * 1024) { res.status(400).json({ error: 'Cell data too large (max 10 MB)' }); return; }
    const tab = await updateCells(workspaceId, req.params.tabId as string, cells);
    res.json(tab);
  } catch (err: any) {
    logger.error('Update cells error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't update cells." });
  }
});

router.post('/:id/tabs/:tabId/rows', async (req: Request, res: Response) => {
  try {
    const { workspaceId } = getSessionUser(req);
    const { rows } = req.body;
    if (!Array.isArray(rows)) { res.status(400).json({ error: 'rows array is required' }); return; }
    if (rows.length > 1000) { res.status(400).json({ error: 'Too many rows in a single append (max 1,000)' }); return; }
    const tab = await appendRows(workspaceId, req.params.tabId as string, rows);
    res.json(tab);
  } catch (err: any) {
    logger.error('Append rows error', { error: err.message });
    res.status(400).json({ error: err.message || "Couldn't append rows." });
  }
});

export default router;
