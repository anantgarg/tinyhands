import { v4 as uuid } from 'uuid';
import { query, queryOne, execute, withTransaction } from '../../db';
import { logger } from '../../utils/logger';
import type { Document, DocType, DocCreatorType, DocumentVersion, SheetTab, CellData } from '../../types';
import { extractTextForSearch } from './convert';
import { storeFile, getFile, deleteFile } from './storage';

// ── Constants ──

const MAX_DOC_VERSIONS = 50;
const MAX_FILE_VERSIONS = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_CELLS_PER_TAB = 50000;

const BLOCKED_EXTENSIONS = ['.exe', '.sh', '.bat', '.dll', '.so', '.cmd', '.com', '.msi', '.scr'];

// ── Document CRUD ──

export interface CreateDocumentParams {
  type: DocType;
  title: string;
  description?: string;
  content?: Record<string, unknown> | null;
  mimeType?: string;
  tags?: string[];
  agentId?: string | null;
  runId?: string | null;
  createdBy: string;
  createdByType: DocCreatorType;
  agentEditable?: boolean;
}

export async function createDocument(workspaceId: string, params: CreateDocumentParams): Promise<Document> {
  const id = uuid();
  const now = new Date().toISOString();

  const doc: Document = {
    id,
    workspace_id: workspaceId,
    type: params.type,
    title: params.title,
    description: params.description || null,
    content: params.type === 'doc' ? (params.content || null) : null,
    mime_type: params.mimeType || null,
    file_size: null,
    tags: params.tags || [],
    agent_id: params.agentId || null,
    run_id: params.runId || null,
    created_by: params.createdBy,
    created_by_type: params.createdByType,
    updated_by: null,
    agent_editable: params.agentEditable ?? true,
    version: 1,
    is_archived: false,
    created_at: now,
    updated_at: now,
  };

  await execute(`
    INSERT INTO documents (id, workspace_id, type, title, description, content, mime_type, file_size,
      tags, agent_id, run_id, created_by, created_by_type, updated_by, agent_editable, version,
      is_archived, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
  `, [
    doc.id, workspaceId, doc.type, doc.title, doc.description,
    doc.content ? JSON.stringify(doc.content) : null,
    doc.mime_type, doc.file_size, JSON.stringify(doc.tags),
    doc.agent_id, doc.run_id, doc.created_by, doc.created_by_type,
    doc.updated_by, doc.agent_editable, doc.version, doc.is_archived,
    doc.created_at, doc.updated_at,
  ]);

  // Index for search
  if (params.type === 'doc' && params.content) {
    await indexDocumentContent(id, params.content);
  }

  // Create initial sheet tab for sheets
  if (params.type === 'sheet') {
    await createSheetTab(workspaceId, id, 'Sheet1');
  }

  logger.info('Document created', { docId: id, type: params.type, title: params.title });
  return doc;
}

export async function getDocument(workspaceId: string, docId: string): Promise<Document | null> {
  const row = await queryOne<Document>(
    `SELECT * FROM documents WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, docId]
  );
  if (!row) return null;
  return parseDocumentRow(row);
}

export interface ListDocumentsOpts {
  type?: DocType;
  agentId?: string;
  createdBy?: string;
  tags?: string[];
  search?: string;
  includeArchived?: boolean;
  page?: number;
  limit?: number;
}

export async function listDocuments(workspaceId: string, opts: ListDocumentsOpts = {}): Promise<{ documents: Document[]; total: number }> {
  const page = opts.page || 1;
  const limit = Math.min(opts.limit || 20, 100);
  const offset = (page - 1) * limit;

  let where = 'WHERE d.workspace_id = $1';
  const params: any[] = [workspaceId];
  let idx = 2;

  if (!opts.includeArchived) {
    where += ' AND d.is_archived = false';
  }
  if (opts.type) {
    where += ` AND d.type = $${idx++}`;
    params.push(opts.type);
  }
  if (opts.agentId) {
    where += ` AND d.agent_id = $${idx++}`;
    params.push(opts.agentId);
  }
  if (opts.createdBy) {
    where += ` AND d.created_by = $${idx++}`;
    params.push(opts.createdBy);
  }
  if (opts.tags && opts.tags.length > 0) {
    where += ` AND d.tags ?| $${idx++}`;
    params.push(opts.tags);
  }
  if (opts.search) {
    where += ` AND (
      d.title ILIKE $${idx} OR
      EXISTS (SELECT 1 FROM document_search ds WHERE ds.document_id = d.id AND ds.search_vector @@ plainto_tsquery('english', $${idx}))
    )`;
    params.push(`%${opts.search}%`);
    idx++;
  }

  const [countRow] = await query(`SELECT count(*)::int as count FROM documents d ${where}`, params);
  const total = countRow?.count ?? 0;

  const rows = await query<Document>(
    `SELECT d.*, a.name as agent_name FROM documents d
     LEFT JOIN agents a ON d.agent_id = a.id
     ${where} ORDER BY d.updated_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    [...params, limit, offset]
  );

  return { documents: rows.map(parseDocumentRow), total };
}

export async function updateDocument(
  workspaceId: string,
  docId: string,
  params: {
    title?: string;
    description?: string;
    content?: Record<string, unknown>;
    tags?: string[];
    agentEditable?: boolean;
    updatedBy: string;
    expectedVersion: number;
  }
): Promise<Document> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (params.title !== undefined) { sets.push(`title = $${idx++}`); vals.push(params.title); }
  if (params.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(params.description); }
  if (params.content !== undefined) { sets.push(`content = $${idx++}`); vals.push(JSON.stringify(params.content)); }
  if (params.tags !== undefined) { sets.push(`tags = $${idx++}`); vals.push(JSON.stringify(params.tags)); }
  if (params.agentEditable !== undefined) { sets.push(`agent_editable = $${idx++}`); vals.push(params.agentEditable); }

  sets.push(`updated_by = $${idx++}`); vals.push(params.updatedBy);
  sets.push(`updated_at = NOW()`);
  sets.push(`version = version + 1`);

  const result = await execute(
    `UPDATE documents SET ${sets.join(', ')} WHERE workspace_id = $${idx++} AND id = $${idx++} AND version = $${idx}`,
    [...vals, workspaceId, docId, params.expectedVersion]
  );

  if (result.rowCount === 0) {
    const exists = await queryOne('SELECT id FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
    if (!exists) throw new Error('Document not found');
    throw new Error('VERSION_CONFLICT');
  }

  // Create version snapshot
  if (params.content !== undefined) {
    await createVersionSnapshot(docId, params.expectedVersion, params.updatedBy, 'Content updated');
    await indexDocumentContent(docId, params.content);
  }

  const doc = await getDocument(workspaceId, docId);
  if (!doc) throw new Error('Document not found after update');
  return doc;
}

export async function archiveDocument(workspaceId: string, docId: string): Promise<void> {
  await execute(
    'UPDATE documents SET is_archived = true, updated_at = NOW() WHERE workspace_id = $1 AND id = $2',
    [workspaceId, docId]
  );
}

export async function deleteDocument(workspaceId: string, docId: string): Promise<void> {
  await execute('DELETE FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  logger.info('Document deleted', { docId });
}

export async function searchDocuments(workspaceId: string, searchQuery: string, limit = 20): Promise<Document[]> {
  const rows = await query<Document>(
    `SELECT d.* FROM documents d
     JOIN document_search ds ON ds.document_id = d.id
     WHERE d.workspace_id = $1 AND d.is_archived = false
       AND ds.search_vector @@ plainto_tsquery('english', $2)
     ORDER BY ts_rank(ds.search_vector, plainto_tsquery('english', $2)) DESC
     LIMIT $3`,
    [workspaceId, searchQuery, limit]
  );
  return rows.map(parseDocumentRow);
}

// ── Versioning ──

async function createVersionSnapshot(docId: string, version: number, changedBy: string, summary?: string): Promise<void> {
  const doc = await queryOne<any>('SELECT content FROM documents WHERE id = $1', [docId]);
  if (!doc) return;

  await execute(
    `INSERT INTO document_versions (id, document_id, version, content, changed_by, change_summary)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (document_id, version) DO NOTHING`,
    [uuid(), docId, version, JSON.stringify(doc.content || {}), changedBy, summary || null]
  );

  // Prune old versions
  const maxVersions = MAX_DOC_VERSIONS;
  await execute(
    `DELETE FROM document_versions WHERE document_id = $1 AND version NOT IN (
      SELECT version FROM document_versions WHERE document_id = $1 ORDER BY version DESC LIMIT $2
    )`,
    [docId, maxVersions]
  );
}

export async function listVersions(workspaceId: string, docId: string): Promise<DocumentVersion[]> {
  // Verify document belongs to workspace
  const doc = await queryOne('SELECT id FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  if (!doc) throw new Error('Document not found');

  return query<DocumentVersion>(
    'SELECT * FROM document_versions WHERE document_id = $1 ORDER BY version DESC',
    [docId]
  );
}

export async function getVersion(workspaceId: string, docId: string, version: number): Promise<DocumentVersion | null> {
  const doc = await queryOne('SELECT id FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  if (!doc) throw new Error('Document not found');

  const row = await queryOne<DocumentVersion>(
    'SELECT * FROM document_versions WHERE document_id = $1 AND version = $2',
    [docId, version]
  );
  return row || null;
}

export async function restoreVersion(workspaceId: string, docId: string, version: number, userId: string): Promise<Document> {
  const ver = await getVersion(workspaceId, docId, version);
  if (!ver) throw new Error('Version not found');

  const current = await getDocument(workspaceId, docId);
  if (!current) throw new Error('Document not found');

  return updateDocument(workspaceId, docId, {
    content: ver.content,
    updatedBy: userId,
    expectedVersion: current.version,
  });
}

// ── Sheet Tab Operations ──

export async function createSheetTab(workspaceId: string, docId: string, name: string): Promise<SheetTab> {
  const doc = await queryOne('SELECT id, type FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  if (!doc) throw new Error('Document not found');
  if ((doc as any).type !== 'sheet') throw new Error('Document is not a sheet');

  const [maxPos] = await query<any>(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM sheet_tabs WHERE document_id = $1',
    [docId]
  );

  const id = uuid();
  const tab: SheetTab = {
    id,
    document_id: docId,
    name,
    position: (maxPos?.max_pos ?? -1) + 1,
    columns: [],
    data: {},
    metadata: {},
    row_count: 0,
    col_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await execute(
    `INSERT INTO sheet_tabs (id, document_id, name, position, columns, data, metadata, row_count, col_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [tab.id, docId, tab.name, tab.position, '[]', '{}', '{}', 0, 0, tab.created_at, tab.updated_at]
  );

  return tab;
}

export async function getSheetTabs(workspaceId: string, docId: string): Promise<SheetTab[]> {
  const doc = await queryOne('SELECT id FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  if (!doc) throw new Error('Document not found');

  const rows = await query<any>(
    'SELECT * FROM sheet_tabs WHERE document_id = $1 ORDER BY position',
    [docId]
  );

  return rows.map(parseSheetTabRow);
}

export async function updateSheetTab(
  workspaceId: string,
  tabId: string,
  params: { name?: string; data?: Record<string, CellData>; metadata?: Record<string, unknown>; columns?: any[] }
): Promise<SheetTab> {
  // Verify ownership
  const tab = await queryOne<any>(
    `SELECT st.* FROM sheet_tabs st JOIN documents d ON st.document_id = d.id
     WHERE st.id = $1 AND d.workspace_id = $2`,
    [tabId, workspaceId]
  );
  if (!tab) throw new Error('Sheet tab not found');

  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 1;

  if (params.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(params.name); }
  if (params.columns !== undefined) { sets.push(`columns = $${idx++}`); vals.push(JSON.stringify(params.columns)); }
  if (params.metadata !== undefined) { sets.push(`metadata = $${idx++}`); vals.push(JSON.stringify(params.metadata)); }

  if (params.data !== undefined) {
    const cellCount = Object.keys(params.data).length;
    if (cellCount > MAX_CELLS_PER_TAB) {
      throw new Error(`Cell count ${cellCount} exceeds maximum of ${MAX_CELLS_PER_TAB}`);
    }
    sets.push(`data = $${idx++}`); vals.push(JSON.stringify(params.data));

    // Compute row/col counts
    const { rowCount, colCount } = computeSheetDimensions(params.data);
    sets.push(`row_count = $${idx++}`); vals.push(rowCount);
    sets.push(`col_count = $${idx++}`); vals.push(colCount);
  }

  sets.push('updated_at = NOW()');

  if (sets.length === 1) return parseSheetTabRow(tab); // only updated_at

  await execute(`UPDATE sheet_tabs SET ${sets.join(', ')} WHERE id = $${idx}`, [...vals, tabId]);

  // Update search index for parent document
  await indexSheetContent(tab.document_id);

  const updated = await queryOne<any>('SELECT * FROM sheet_tabs WHERE id = $1', [tabId]);
  return parseSheetTabRow(updated!);
}

export async function deleteSheetTab(workspaceId: string, tabId: string): Promise<void> {
  const tab = await queryOne<any>(
    `SELECT st.document_id FROM sheet_tabs st JOIN documents d ON st.document_id = d.id
     WHERE st.id = $1 AND d.workspace_id = $2`,
    [tabId, workspaceId]
  );
  if (!tab) throw new Error('Sheet tab not found');

  // Don't delete the last tab
  const [countRow] = await query<any>(
    'SELECT count(*)::int as count FROM sheet_tabs WHERE document_id = $1',
    [tab.document_id]
  );
  if ((countRow?.count ?? 0) <= 1) {
    throw new Error('Cannot delete the last tab in a sheet');
  }

  await execute('DELETE FROM sheet_tabs WHERE id = $1', [tabId]);
}

export async function reorderSheetTabs(workspaceId: string, docId: string, tabIds: string[]): Promise<void> {
  const doc = await queryOne('SELECT id FROM documents WHERE workspace_id = $1 AND id = $2', [workspaceId, docId]);
  if (!doc) throw new Error('Document not found');

  await withTransaction(async (client) => {
    for (let i = 0; i < tabIds.length; i++) {
      await client.query('UPDATE sheet_tabs SET position = $1 WHERE id = $2 AND document_id = $3', [i, tabIds[i], docId]);
    }
  });
}

export async function updateCells(
  workspaceId: string,
  tabId: string,
  cells: Record<string, CellData>
): Promise<SheetTab> {
  const tab = await queryOne<any>(
    `SELECT st.* FROM sheet_tabs st JOIN documents d ON st.document_id = d.id
     WHERE st.id = $1 AND d.workspace_id = $2`,
    [tabId, workspaceId]
  );
  if (!tab) throw new Error('Sheet tab not found');

  // Merge cells into existing data
  const existingData = typeof tab.data === 'string' ? JSON.parse(tab.data) : (tab.data || {});
  const merged = { ...existingData, ...cells };

  // Remove cells with null value (deletion)
  for (const [key, val] of Object.entries(cells)) {
    if (val === null || (val as CellData).v === null) {
      delete merged[key];
    }
  }

  return updateSheetTab(workspaceId, tabId, { data: merged });
}

export async function appendRows(
  workspaceId: string,
  tabId: string,
  rows: (string | number | boolean | null)[][]
): Promise<SheetTab> {
  const tab = await queryOne<any>(
    `SELECT st.* FROM sheet_tabs st JOIN documents d ON st.document_id = d.id
     WHERE st.id = $1 AND d.workspace_id = $2`,
    [tabId, workspaceId]
  );
  if (!tab) throw new Error('Sheet tab not found');

  const existingData: Record<string, CellData> = typeof tab.data === 'string' ? JSON.parse(tab.data) : (tab.data || {});
  const startRow = (tab.row_count || 0) + 1;

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const cellRef = columnLetter(c) + (startRow + r);
      existingData[cellRef] = { v: rows[r][c] };
    }
  }

  return updateSheetTab(workspaceId, tabId, { data: existingData });
}

// ── File Operations ──

export async function uploadFile(
  workspaceId: string,
  params: {
    title: string;
    mimeType: string;
    data: Buffer;
    createdBy: string;
    createdByType: DocCreatorType;
    agentId?: string;
    runId?: string;
    tags?: string[];
  }
): Promise<Document> {
  // Validate file
  if (params.data.length > MAX_FILE_SIZE) {
    throw new Error(`File size ${params.data.length} exceeds maximum of ${MAX_FILE_SIZE} bytes`);
  }
  const ext = params.title.includes('.') ? '.' + params.title.split('.').pop()!.toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    throw new Error(`File type ${ext} is not allowed`);
  }

  const doc = await createDocument(workspaceId, {
    type: 'file',
    title: params.title,
    mimeType: params.mimeType,
    tags: params.tags,
    agentId: params.agentId,
    runId: params.runId,
    createdBy: params.createdBy,
    createdByType: params.createdByType,
  });

  // Store file data
  await storeFile(doc.id, params.data);

  // Update file_size on document
  await execute('UPDATE documents SET file_size = $1 WHERE id = $2', [params.data.length, doc.id]);
  doc.file_size = params.data.length;

  // Index for search (extract text from supported files)
  const text = await extractTextFromFile(params.title, params.mimeType, params.data);
  if (text) {
    await indexDocumentText(doc.id, text);
  }

  return doc;
}

export async function getFileDownload(workspaceId: string, docId: string): Promise<{ data: Buffer; mimeType: string; title: string }> {
  const doc = await getDocument(workspaceId, docId);
  if (!doc) throw new Error('Document not found');
  if (doc.type !== 'file') throw new Error('Document is not a file');

  const data = await getFile(docId);
  if (!data) throw new Error('File data not found');

  return { data, mimeType: doc.mime_type || 'application/octet-stream', title: doc.title };
}

export async function updateFileContent(
  workspaceId: string,
  docId: string,
  data: Buffer,
  updatedBy: string
): Promise<Document> {
  const doc = await getDocument(workspaceId, docId);
  if (!doc) throw new Error('Document not found');
  if (doc.type !== 'file') throw new Error('Document is not a file');
  if (data.length > MAX_FILE_SIZE) {
    throw new Error(`File size ${data.length} exceeds maximum of ${MAX_FILE_SIZE} bytes`);
  }

  // Create version of old file
  const oldData = await getFile(docId);
  if (oldData) {
    await execute(
      `INSERT INTO document_versions (id, document_id, version, content, changed_by, change_summary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuid(), docId, doc.version, JSON.stringify({ file_size: doc.file_size }), updatedBy, 'File replaced']
    );
    // Prune old file versions
    await execute(
      `DELETE FROM document_versions WHERE document_id = $1 AND version NOT IN (
        SELECT version FROM document_versions WHERE document_id = $1 ORDER BY version DESC LIMIT $2
      )`,
      [docId, MAX_FILE_VERSIONS]
    );
  }

  // Replace file data
  await deleteFile(docId);
  await storeFile(docId, data);

  // Update document record
  await execute(
    'UPDATE documents SET file_size = $1, updated_by = $2, updated_at = NOW(), version = version + 1 WHERE id = $3',
    [data.length, updatedBy, docId]
  );

  // Re-index text
  const text = await extractTextFromFile(doc.title, doc.mime_type || '', data);
  if (text) {
    await indexDocumentText(docId, text);
  }

  return (await getDocument(workspaceId, docId))!;
}

// ── Search Indexing ──

async function indexDocumentContent(docId: string, content: Record<string, unknown>): Promise<void> {
  try {
    const text = extractTextForSearch(content);
    await indexDocumentText(docId, text);
  } catch (err: any) {
    logger.warn('Failed to index document content', { docId, error: err.message });
  }
}

async function indexSheetContent(docId: string): Promise<void> {
  try {
    const tabs = await query<any>('SELECT data FROM sheet_tabs WHERE document_id = $1', [docId]);
    const texts: string[] = [];
    for (const tab of tabs) {
      const data: Record<string, CellData> = typeof tab.data === 'string' ? JSON.parse(tab.data) : (tab.data || {});
      for (const cell of Object.values(data)) {
        if (cell.v !== null && cell.v !== undefined) {
          texts.push(String(cell.v));
        }
      }
    }
    await indexDocumentText(docId, texts.join(' '));
  } catch (err: any) {
    logger.warn('Failed to index sheet content', { docId, error: err.message });
  }
}

async function indexDocumentText(docId: string, text: string): Promise<void> {
  const truncated = text.slice(0, 100000); // limit indexed text
  await execute(
    `INSERT INTO document_search (id, document_id, content_text)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id) DO UPDATE SET content_text = $3`,
    [uuid(), docId, truncated]
  );
}

// ── Text Extraction from Files ──

async function extractTextFromFile(filename: string, mimeType: string, data: Buffer): Promise<string | null> {
  // Text-based files
  if (mimeType.startsWith('text/') || isTextMimeType(mimeType)) {
    return data.toString('utf-8').slice(0, 100000);
  }

  // PDF extraction
  if (mimeType === 'application/pdf') {
    try {
      const pdfParse = await import('pdf-parse');
      const result = await pdfParse.default(data);
      return result.text.slice(0, 100000);
    } catch {
      logger.warn('PDF text extraction failed', { filename });
      return null;
    }
  }

  // DOCX extraction
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: data });
      return result.value.slice(0, 100000);
    } catch {
      logger.warn('DOCX text extraction failed', { filename });
      return null;
    }
  }

  return null;
}

function isTextMimeType(mimeType: string): boolean {
  return ['application/json', 'application/xml', 'application/yaml', 'application/x-yaml',
    'application/javascript', 'application/typescript', 'application/sql',
    'text/csv', 'text/markdown', 'text/html', 'text/css',
  ].includes(mimeType);
}

// ── Document Stats ──

export async function getDocumentStats(workspaceId: string): Promise<{
  totalDocs: number; totalSheets: number; totalFiles: number; totalArchived: number;
}> {
  const [row] = await query<any>(`
    SELECT
      count(*) FILTER (WHERE type = 'doc' AND NOT is_archived)::int as total_docs,
      count(*) FILTER (WHERE type = 'sheet' AND NOT is_archived)::int as total_sheets,
      count(*) FILTER (WHERE type = 'file' AND NOT is_archived)::int as total_files,
      count(*) FILTER (WHERE is_archived)::int as total_archived
    FROM documents WHERE workspace_id = $1
  `, [workspaceId]);

  return {
    totalDocs: row?.total_docs ?? 0,
    totalSheets: row?.total_sheets ?? 0,
    totalFiles: row?.total_files ?? 0,
    totalArchived: row?.total_archived ?? 0,
  };
}

// ── Helpers ──

function parseDocumentRow(row: any): Document {
  return {
    ...row,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
  };
}

function parseSheetTabRow(row: any): SheetTab {
  return {
    ...row,
    columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : (row.columns || []),
    data: typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {}),
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
  };
}

function computeSheetDimensions(data: Record<string, CellData>): { rowCount: number; colCount: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(data)) {
    const match = key.match(/^([A-Z]+)(\d+)$/);
    if (match) {
      const row = parseInt(match[2], 10);
      const col = columnIndex(match[1]);
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    }
  }
  return { rowCount: maxRow, colCount: maxCol };
}

function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function columnIndex(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 64);
  }
  return result;
}

// Re-export for API layer
export { MAX_FILE_SIZE, BLOCKED_EXTENSIONS };
