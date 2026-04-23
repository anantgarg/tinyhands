/**
 * Document parser dispatcher for KB source sync.
 *
 * Takes raw bytes + MIME type and returns extracted plain text. If a
 * workspace has Reducto enabled, PDFs (and any format whose local parser
 * throws) are routed through Reducto first, with automatic fallback to the
 * local parser on Reducto errors. Parsers run inside the sync process — not
 * the per-run Docker runner — because sync is a trusted platform process
 * and parsing large spreadsheets/PDFs should not block the agent worker
 * pool.
 */

import { logger } from '../../../utils/logger';
import { isReductoEnabledAndConfigured, parseWithReducto } from '../../reducto';
import { parseDocx } from './docx';
import { parseXlsx } from './xlsx';
import { parsePptx } from './pptx';
import { parsePdf } from './pdf';
import { parseRtf } from './rtf';
import { parseHtml } from './html';
import { parsePlainText } from './plain';
import type { ParseInput, ParseResult } from './types';

export type { ParseInput, ParseResult } from './types';
export { MAX_EXTRACTED_TEXT_CHARS } from './types';

// Format families Reducto handles better than local parsers. Plain text,
// Markdown, CSV, and HTML always use local parsers — it would waste Reducto
// credits to send them over the wire since local extraction is already
// perfect. Reducto handles the rest (docx / xlsx / pptx / pdf) per
// https://docs.reducto.ai/upload/overview.
const REDUCTO_PREFERRED_FAMILIES = new Set<ParserFamily>([
  'docx', 'docx-legacy',
  'xlsx', 'xlsx-legacy',
  'pptx', 'pptx-legacy',
  'pdf',
  'image',
]);

// Format families. We key on file extension because Google Drive sometimes
// reports generic `application/octet-stream` for Office files; the filename
// is a more reliable signal for those cases.
const EXT_TO_FAMILY: Record<string, ParserFamily> = {
  docx: 'docx',
  doc: 'docx-legacy',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xls: 'xlsx-legacy',
  pptx: 'pptx',
  ppt: 'pptx-legacy',
  pdf: 'pdf',
  odt: 'pptx',
  ods: 'xlsx',
  odp: 'pptx',
  rtf: 'rtf',
  html: 'html',
  htm: 'html',
  txt: 'plain',
  md: 'plain',
  markdown: 'plain',
  csv: 'plain',
  tsv: 'plain',
  json: 'plain',
  log: 'plain',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
};

const MIME_TO_FAMILY: Record<string, ParserFamily> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx-legacy',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx-legacy',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx-legacy',
  'application/pdf': 'pdf',
  'application/vnd.oasis.opendocument.text': 'pptx',
  'application/vnd.oasis.opendocument.spreadsheet': 'xlsx',
  'application/vnd.oasis.opendocument.presentation': 'pptx',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/html': 'html',
  'text/plain': 'plain',
  'text/markdown': 'plain',
  'text/csv': 'plain',
  'text/tab-separated-values': 'plain',
  'application/json': 'plain',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
};

type ParserFamily =
  | 'docx' | 'docx-legacy'
  | 'xlsx' | 'xlsx-legacy'
  | 'pptx' | 'pptx-legacy'
  | 'pdf' | 'rtf' | 'html' | 'plain' | 'image';

function resolveFamily(mimeType: string, filename: string): ParserFamily | null {
  const byMime = MIME_TO_FAMILY[mimeType.toLowerCase()];
  if (byMime) return byMime;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return EXT_TO_FAMILY[ext] || (mimeType.startsWith('text/') ? 'plain' : null);
}

async function runLocalParser(family: ParserFamily, input: ParseInput): Promise<ParseResult> {
  switch (family) {
    case 'docx':
    case 'docx-legacy':
      return parseDocx(input);
    case 'xlsx':
    case 'xlsx-legacy':
      return parseXlsx(input);
    case 'pptx':
    case 'pptx-legacy':
      return parsePptx(input);
    case 'pdf':
      return parsePdf(input);
    case 'rtf':
      return parseRtf(input);
    case 'html':
      return parseHtml(input);
    case 'plain':
      return parsePlainText(input);
    case 'image':
      // Images have no local OCR engine — Reducto is required. When the
      // dispatcher reaches this case, it means Reducto is disabled or its
      // upstream call failed; surface a clear, admin-actionable result so
      // sync-handlers can map it to the `reducto_required` skip reason.
      return {
        text: '',
        warnings: [`${input.filename}: image OCR requires Reducto to be enabled for this workspace`],
        metadata: { parser: 'image-no-reducto' },
      };
  }
}

export async function parseDocument(input: ParseInput): Promise<ParseResult> {
  const family = resolveFamily(input.mimeType, input.filename);
  if (!family) {
    return {
      text: '',
      warnings: [`${input.filename}: unsupported file type (${input.mimeType || 'unknown'}) — skipped`],
      metadata: { parser: 'none' },
    };
  }

  // Skip the Reducto DB lookup entirely for plain-text / markdown / CSV /
  // HTML / RTF — Reducto would never be called for those anyway (it'd be
  // wasteful), and this keeps the hot path (most Drive files are small
  // text/markdown) out of the settings table.
  const reductoCandidate = REDUCTO_PREFERRED_FAMILIES.has(family);
  const reductoEnabled = reductoCandidate ? await isReductoEnabledAndConfigured(input.workspaceId) : false;
  const shouldTryReducto = reductoEnabled && reductoCandidate;

  // Images have no local fallback. Handle them separately so the caller gets
  // a precise metadata signal: `image-no-reducto` when the workspace hasn't
  // enabled Reducto, `reducto-failed` when Reducto rejected the upload.
  if (family === 'image') {
    if (!reductoEnabled) {
      return runLocalParser('image', input);
    }
    try {
      const result = await parseWithReducto(input);
      logger.info('Parsed image via Reducto', { filename: input.filename, chars: result.text.length });
      return result;
    } catch (err: any) {
      logger.warn('Reducto image parse failed', { filename: input.filename, error: err.message });
      return {
        text: '',
        warnings: [`${input.filename}: image OCR via Reducto failed (${err.message})`],
        metadata: { parser: 'reducto-failed' },
      };
    }
  }

  // First attempt: Reducto if enabled and the format is one it handles well.
  if (shouldTryReducto) {
    try {
      const result = await parseWithReducto(input);
      logger.info('Parsed document via Reducto', { filename: input.filename, chars: result.text.length });
      return result;
    } catch (err: any) {
      logger.warn('Reducto parse failed, falling back to local parser', { filename: input.filename, error: err.message });
      // Reducto already failed; don't retry it from the local path.
      const local = await tryLocalWithReductoFallback(family, input, false);
      local.warnings.unshift(`${input.filename}: Reducto parse failed (${err.message}); used local parser instead`);
      return local;
    }
  }

  // Local parser path — if it fails and Reducto is enabled, try Reducto as fallback.
  return tryLocalWithReductoFallback(family, input, reductoEnabled);
}

async function tryLocalWithReductoFallback(
  family: ParserFamily,
  input: ParseInput,
  reductoEnabled: boolean,
): Promise<ParseResult> {
  try {
    const result = await runLocalParser(family, input);
    if (!result.text.trim() && reductoEnabled && !REDUCTO_PREFERRED_FAMILIES.has(family)) {
      // Empty extraction from a local parser is a common failure mode for
      // scanned or image-heavy documents. If Reducto is on, give it a shot.
      try {
        const reducto = await parseWithReducto(input);
        if (reducto.text.trim()) return reducto;
      } catch (err: any) {
        result.warnings.push(`${input.filename}: Reducto fallback also failed (${err.message})`);
      }
    }
    return result;
  } catch (err: any) {
    logger.warn('Local parser failed', { filename: input.filename, family, error: err.message });
    if (reductoEnabled) {
      try {
        const reducto = await parseWithReducto(input);
        return {
          ...reducto,
          warnings: [`${input.filename}: local ${family} parser failed (${err.message}); used Reducto instead`, ...reducto.warnings],
        };
      } catch (reductoErr: any) {
        return {
          text: '',
          warnings: [`${input.filename}: local ${family} parser failed (${err.message}); Reducto also failed (${reductoErr.message})`],
          metadata: { parser: 'failed' },
        };
      }
    }
    return {
      text: '',
      warnings: [`${input.filename}: ${family} parser failed — ${err.message}`],
      metadata: { parser: 'failed' },
    };
  }
}
