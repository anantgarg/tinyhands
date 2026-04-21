/**
 * Parser router. Decides which parser handles a given source.
 *
 * Decision order:
 *   1. Native KB entries / native Documents content → local (no binary).
 *   2. Text-native binary → local (cheap, fast, no API spend).
 *   3. Reducto if configured → cloud parse.
 *   4. LlamaParse if configured → cloud parse.
 *   5. local fallback (may emit image-only placeholder for OCR-required content).
 */
import path from 'path';
import { logger } from '../../utils/logger';
import { getApiKey } from '../kb-sources';
import type { ParsedSource, WikiSource } from '../../types';
import { parseLocal, isTextLike, requiresCloudParser, renderDocContent, renderSheetTabs } from './local';
import { parseReducto } from './reducto';
import { parseLlamaParse } from './llamaparse';

export interface ParseRequest {
  workspaceId: string;
  source: WikiSource;
  /** Filename hint (optional for native sources). */
  filename?: string;
  /** MIME hint. */
  mime?: string;
  /** For binary sources: the raw bytes. */
  bytes?: Buffer;
  /** For native KB entries: pre-rendered Markdown. */
  inlineMarkdown?: string;
  /** For native documents: doc Slate content + sheet tabs. */
  inlineDoc?: { content?: unknown; sheetTabs?: Array<{ name: string; data: Record<string, any>; row_count?: number; col_count?: number }> };
}

export async function parseSource(req: ParseRequest): Promise<ParsedSource> {
  // 1. Native KB entry — Markdown is already inline.
  if (req.source.source_kind === 'kb_entry' && req.inlineMarkdown != null) {
    return {
      markdown: req.inlineMarkdown.slice(0, 200_000),
      tables: [],
      metadata: { format: 'kb_entry' },
      parser: 'local',
    };
  }

  // 1b. Native Documents content (doc/sheet) — render JSONB locally.
  if (req.source.source_kind === 'document' && req.inlineDoc) {
    const parts: string[] = [];
    if (req.inlineDoc.content) parts.push(renderDocContent(req.inlineDoc.content));
    if (req.inlineDoc.sheetTabs && req.inlineDoc.sheetTabs.length) parts.push(renderSheetTabs(req.inlineDoc.sheetTabs));
    return {
      markdown: parts.join('\n\n'),
      tables: [],
      metadata: { format: 'document_native' },
      parser: 'local',
    };
  }

  // 2-5. Binary path. Need bytes.
  if (!req.bytes) {
    throw new Error('parseSource: binary source requires bytes');
  }
  const filename = req.filename || 'unnamed';
  const mime = req.mime || '';
  const ext = path.extname(filename).toLowerCase();

  // 2. Text-native binary — always local.
  if (isTextLike(ext, mime)) {
    return parseLocal({ filename, mime, bytes: req.bytes });
  }

  // 3-4. Cloud parsers, in order.
  const reductoConfigured = await isConfigured(req.workspaceId, 'reducto');
  const llamaConfigured = await isConfigured(req.workspaceId, 'llamaparse');

  if (reductoConfigured) {
    try {
      return await parseReducto({ workspaceId: req.workspaceId, filename, mime, bytes: req.bytes });
    } catch (err: any) {
      logger.warn('Reducto failed, falling back', { filename, error: err.message });
      // Fall through to LlamaParse / local
    }
  }
  if (llamaConfigured) {
    try {
      return await parseLlamaParse({ workspaceId: req.workspaceId, filename, mime, bytes: req.bytes });
    } catch (err: any) {
      logger.warn('LlamaParse failed, falling back to local', { filename, error: err.message });
    }
  }

  // 5. Local fallback. May emit a placeholder for OCR-required content.
  if (requiresCloudParser(filename, mime) && !reductoConfigured && !llamaConfigured) {
    logger.info('OCR-required source with no cloud parser configured', { filename, mime });
  }
  return parseLocal({ filename, mime, bytes: req.bytes });
}

async function isConfigured(workspaceId: string, provider: 'reducto' | 'llamaparse'): Promise<boolean> {
  try {
    const key = await getApiKey(workspaceId, provider);
    return !!(key && key.setup_complete);
  } catch {
    return false;
  }
}
