/**
 * Local parsers — no external API calls. Used for text-native formats
 * always, and as a best-effort fallback for binary formats when no cloud
 * parser is configured.
 *
 * For image-only content (raw images, scanned PDFs with no text layer,
 * legacy .doc/.ppt/.xls binaries we can't parse, Apple iWork) we emit a
 * placeholder note rather than silently dropping the source — the agent
 * needs to know that bytes were seen but couldn't be read.
 */
import path from 'path';
import { logger } from '../../utils/logger';
import type { ParsedSource } from '../../types';

// ── Public entry points ──

export interface LocalParseInput {
  filename: string;
  mime: string;
  bytes: Buffer;
  /** Recursion depth for archives — capped to prevent zip bombs. */
  depth?: number;
}

const MAX_RECURSION_DEPTH = 3;

export async function parseLocal(input: LocalParseInput): Promise<ParsedSource> {
  const ext = path.extname(input.filename).toLowerCase();
  const mime = (input.mime || '').toLowerCase();

  // Archives — extract and recurse
  if (ext === '.zip' || ext === '.tar' || ext === '.gz' || mime === 'application/zip') {
    return parseArchive(input);
  }

  // Email
  if (ext === '.eml' || ext === '.msg' || mime === 'message/rfc822') {
    return parseEmail(input);
  }

  // PDFs (text layer)
  if (ext === '.pdf' || mime === 'application/pdf') {
    return parsePdf(input);
  }

  // DOCX
  if (ext === '.docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return parseDocx(input);
  }

  // XLSX / XLS
  if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') {
    return parseSpreadsheet(input);
  }

  // PPTX, ODT, ODS, ODP via officeparser
  if (['.pptx', '.odt', '.ods', '.odp'].includes(ext)) {
    return parseOffice(input);
  }

  // EPUB
  if (ext === '.epub' || mime === 'application/epub+zip') {
    return parseEpub(input);
  }

  // CSV / TSV — detect BEFORE the generic text path so we get Markdown tables.
  if (ext === '.csv' || mime === 'text/csv') {
    return parseDelimited(input, ',');
  }
  if (ext === '.tsv' || mime === 'text/tab-separated-values') {
    return parseDelimited(input, '\t');
  }

  // Text-native (any text/* MIME, plus the formats below by extension)
  if (isTextLike(ext, mime)) {
    return parseText(input);
  }

  // OCR-required (raw images, legacy Office we can't parse locally, iWork).
  if (requiresCloudParser(input.filename, mime)) {
    return placeholder(input, 'image-only / OCR-required — configure Reducto or LlamaParse for OCR');
  }

  // Anything else → placeholder
  return placeholder(input, 'unsupported format — convert to PDF or DOCX');
}

export function isTextLike(ext: string, mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  const textMimes = new Set([
    'application/json', 'application/xml', 'application/yaml', 'application/x-yaml',
    'application/javascript', 'application/typescript', 'application/sql',
  ]);
  if (textMimes.has(mime)) return true;
  const textExts = new Set([
    '.txt', '.md', '.markdown', '.html', '.htm', '.htmls',
    '.json', '.xml', '.yaml', '.yml', '.toml', '.ini',
    '.rtf', '.vtt', '.srt',
    '.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.java', '.rb', '.sh',
    '.sql', '.css', '.scss', '.c', '.cc', '.cpp', '.h', '.hpp', '.rs', '.kt',
  ]);
  return textExts.has(ext);
}

/** True when the format absolutely requires a cloud parser to be useful. */
export function requiresCloudParser(filename: string, mime: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (['.tiff', '.tif', '.heic', '.webp', '.bmp', '.gif', '.png', '.jpg', '.jpeg'].includes(ext)) return true;
  if (['.doc', '.ppt'].includes(ext)) return true; // .xls is handled by `xlsx` lib locally
  if (['.pages', '.numbers', '.key'].includes(ext)) return true;
  return false;
}

// ── Format-specific implementations ──

const MAX_TEXT = 200_000; // soft cap for any single body returned to the wiki

function parseText(input: LocalParseInput): ParsedSource {
  const text = input.bytes.toString('utf-8').slice(0, MAX_TEXT);
  return {
    markdown: text,
    tables: [],
    metadata: { format: 'text', size: input.bytes.length },
    parser: 'local',
  };
}

function parseDelimited(input: LocalParseInput, sep: string): ParsedSource {
  const text = input.bytes.toString('utf-8');
  const rows = text.split(/\r?\n/).filter(Boolean).map(r => r.split(sep));
  if (rows.length === 0) return parseText(input);
  const header = rows[0];
  const body = rows.slice(1);
  const md = renderMarkdownTable(header, body);
  return {
    markdown: md,
    tables: [{ markdown: md }],
    metadata: { format: sep === ',' ? 'csv' : 'tsv', rows: body.length, columns: header.length },
    parser: 'local',
  };
}

async function parsePdf(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const pdfParse = await import('pdf-parse');
    const result = await pdfParse.default(input.bytes);
    const text = (result.text || '').trim();
    if (!text || text.length < 20) {
      return placeholder(input, 'image-only PDF (no text layer detected) — configure Reducto or LlamaParse for OCR');
    }
    return {
      markdown: text.slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'pdf', pages: result.numpages, size: input.bytes.length },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local PDF parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `PDF parse error (${err.message})`);
  }
}

async function parseDocx(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const mammoth: any = await import('mammoth');
    // mammoth's TS types don't expose convertToMarkdown but it's part of the
    // runtime API since ~1.5.x; cast to access without losing the rest of
    // the typed surface in callers.
    const fn = mammoth.convertToMarkdown || mammoth.default?.convertToMarkdown;
    const result = fn
      ? await fn({ buffer: input.bytes })
      : await (mammoth.extractRawText({ buffer: input.bytes }));
    return {
      markdown: String(result.value).slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'docx', warnings: result.messages?.length ?? 0 },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local DOCX parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `DOCX parse error (${err.message})`);
  }
}

async function parseSpreadsheet(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const xlsxMod = await import('xlsx');
    const xlsx: any = (xlsxMod as any).default || xlsxMod;
    const wb = xlsx.read(input.bytes, { type: 'buffer' });
    const tables: Array<{ name?: string; markdown: string }> = [];
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames as string[]) {
      const ws = wb.Sheets[sheetName];
      const rows: any[][] = xlsx.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[];
      if (!rows.length) continue;
      const header = (rows[0] || []).map((v: any) => String(v ?? ''));
      const body = rows.slice(1).map((r: any[]) => r.map(v => v == null ? '' : String(v)));
      const md = renderMarkdownTable(header, body);
      tables.push({ name: sheetName, markdown: md });
      parts.push(`## Sheet: ${sheetName}\n\n${md}`);
    }
    const markdown = parts.join('\n\n').slice(0, MAX_TEXT);
    return {
      markdown,
      tables,
      metadata: { format: 'spreadsheet', sheets: wb.SheetNames.length },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local spreadsheet parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `Spreadsheet parse error (${err.message})`);
  }
}

async function parseOffice(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const mod: any = await import('officeparser');
    const fn = mod.parseOfficeAsync || mod.default?.parseOfficeAsync;
    if (!fn) throw new Error('officeparser API not found');
    const text = String(await fn(input.bytes));
    return {
      markdown: text.slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'office', size: input.bytes.length },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local office parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `Office parse error (${err.message}) — configure a cloud parser for full fidelity`);
  }
}

async function parseEmail(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const mod: any = await import('mailparser');
    const fn = mod.simpleParser || mod.default?.simpleParser;
    if (!fn) throw new Error('mailparser API not found');
    const parsed = await fn(input.bytes);
    const subject = parsed.subject || '(no subject)';
    const from = parsed.from?.text || '';
    const to = parsed.to?.text || '';
    const date = parsed.date ? new Date(parsed.date).toISOString() : '';
    const body = parsed.text || (parsed.html ? stripHtml(String(parsed.html)) : '');

    const parts: string[] = [];
    parts.push(`# ${subject}`);
    if (from) parts.push(`**From:** ${from}`);
    if (to) parts.push(`**To:** ${to}`);
    if (date) parts.push(`**Date:** ${date}`);
    parts.push('');
    parts.push(body || '_(empty body)_');

    const attachments: Array<{ filename: string; mime: string; size: number }> = [];
    for (const att of (parsed.attachments || [])) {
      attachments.push({
        filename: att.filename || 'unnamed',
        mime: att.contentType || 'application/octet-stream',
        size: att.size || (att.content?.length ?? 0),
      });
      parts.push(`\n## Attachment: ${att.filename || 'unnamed'} (${att.contentType})`);
      // Recurse into attachment if depth allows
      if ((input.depth || 0) < MAX_RECURSION_DEPTH && att.content) {
        try {
          const sub = await parseLocal({
            filename: att.filename || 'attachment.bin',
            mime: att.contentType || 'application/octet-stream',
            bytes: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
            depth: (input.depth || 0) + 1,
          });
          parts.push(sub.markdown.slice(0, 20_000));
        } catch (err: any) {
          parts.push(`_(attachment parse failed: ${err.message})_`);
        }
      }
    }

    return {
      markdown: parts.join('\n').slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'email', subject, from, to, date, attachments },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local email parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `Email parse error (${err.message})`);
  }
}

async function parseArchive(input: LocalParseInput): Promise<ParsedSource> {
  if ((input.depth || 0) >= MAX_RECURSION_DEPTH) {
    return placeholder(input, `archive depth limit (${MAX_RECURSION_DEPTH}) reached`);
  }
  try {
    const unzipper: any = await import('unzipper');
    const dir = await unzipper.Open.buffer(input.bytes);
    const parts: string[] = [`# Archive: ${input.filename}`];
    const entries: Array<{ path: string; size: number }> = [];
    for (const entry of dir.files) {
      if (entry.type === 'Directory') continue;
      entries.push({ path: entry.path, size: entry.uncompressedSize ?? 0 });
      try {
        const buf: Buffer = await entry.buffer();
        const sub = await parseLocal({
          filename: entry.path,
          mime: '',  // let extension drive it
          bytes: buf,
          depth: (input.depth || 0) + 1,
        });
        parts.push(`\n## ${entry.path}\n\n${sub.markdown.slice(0, 20_000)}`);
      } catch (err: any) {
        parts.push(`\n## ${entry.path}\n\n_(parse failed: ${err.message})_`);
      }
    }
    return {
      markdown: parts.join('\n').slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'archive', entries },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local archive parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `Archive parse error (${err.message})`);
  }
}

async function parseEpub(input: LocalParseInput): Promise<ParsedSource> {
  try {
    const mod: any = await import('epub2');
    // epub2 wants a temp file; for simplicity, fall back to text extraction
    // by treating the EPUB as a zip and pulling chapter HTML.
    const unzipper: any = await import('unzipper');
    const dir = await unzipper.Open.buffer(input.bytes);
    const parts: string[] = [];
    for (const entry of dir.files) {
      if (entry.type === 'Directory') continue;
      if (!/\.(x?html?|xml)$/i.test(entry.path)) continue;
      const buf: Buffer = await entry.buffer();
      parts.push(stripHtml(buf.toString('utf-8')));
    }
    void mod; // silence unused-import warning — real impl could swap to mod for richer metadata
    return {
      markdown: parts.join('\n\n').slice(0, MAX_TEXT),
      tables: [],
      metadata: { format: 'epub' },
      parser: 'local',
    };
  } catch (err: any) {
    logger.warn('Local EPUB parse failed', { filename: input.filename, error: err.message });
    return placeholder(input, `EPUB parse error (${err.message}) — configure LlamaParse for full eBook support`);
  }
}

// ── Helpers ──

function placeholder(input: LocalParseInput, reason: string): ParsedSource {
  const md = `# ${input.filename}\n\n**This source could not be fully read.**\n\n_${reason}_\n\n- size: ${input.bytes.length} bytes\n- mime: ${input.mime || 'unknown'}\n`;
  return {
    markdown: md,
    tables: [],
    metadata: { format: 'placeholder', reason, size: input.bytes.length },
    parser: 'local',
  };
}

function renderMarkdownTable(header: string[], body: string[][]): string {
  if (!header.length) return '';
  const headerCells = header.map(h => h.length ? h : ' ');
  const sep = headerCells.map(() => '---');
  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map(row => `| ${row.map(c => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Render native Documents content (Slate JSONB) as Markdown. */
export function renderDocContent(content: unknown): string {
  if (!content) return '';
  // Slate-like nodes: { type, children: [{ text }] }
  function walk(node: any): string {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(walk).join('\n');
    if (node?.text) return String(node.text);
    if (node?.children) {
      const inner = node.children.map(walk).join('');
      switch (node.type) {
        case 'heading-one': return `\n# ${inner}\n`;
        case 'heading-two': return `\n## ${inner}\n`;
        case 'heading-three': return `\n### ${inner}\n`;
        case 'list-item': return `- ${inner}\n`;
        case 'numbered-list': return `1. ${inner}\n`;
        case 'block-quote': return `> ${inner}\n`;
        case 'code': return `\n\`\`\`\n${inner}\n\`\`\`\n`;
        case 'paragraph':
        default:
          return `${inner}\n`;
      }
    }
    return '';
  }
  return walk(content).slice(0, MAX_TEXT);
}

/** Render sheet_tabs as a Markdown table per tab. */
export function renderSheetTabs(tabs: Array<{ name: string; data: Record<string, any>; row_count?: number; col_count?: number }>): string {
  const parts: string[] = [];
  for (const tab of tabs) {
    parts.push(`## ${tab.name}`);
    const cells = tab.data || {};
    const rows: string[][] = [];
    const maxRow = Math.min(tab.row_count || 0, 200);
    const maxCol = Math.min(tab.col_count || 0, 30);
    if (maxRow === 0 || maxCol === 0) {
      parts.push('_(empty)_\n');
      continue;
    }
    const header = [];
    for (let c = 0; c < maxCol; c++) header.push(columnLetter(c));
    for (let r = 1; r <= maxRow; r++) {
      const row = [];
      for (let c = 0; c < maxCol; c++) {
        const ref = columnLetter(c) + r;
        const cell = cells[ref];
        row.push(cell?.v == null ? '' : String(cell.v));
      }
      rows.push(row);
    }
    parts.push(renderMarkdownTable(header, rows));
    parts.push('');
  }
  return parts.join('\n').slice(0, MAX_TEXT);
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
