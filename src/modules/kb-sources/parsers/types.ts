/**
 * Shared types for KB source document parsers.
 *
 * Each parser takes raw bytes + metadata and returns extracted plain text
 * plus any per-file warnings. Warnings bubble up to the sync run summary so
 * admins can see which files were parsed with degraded fidelity (or skipped
 * entirely) without aborting the whole sync.
 */

export interface ParseInput {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  workspaceId: string;
}

export interface ParseResult {
  text: string;
  warnings: string[];
  metadata: Record<string, unknown>;
}

// Practical upper bound on extracted text per entry. Guards against pathological
// documents (huge spreadsheets, multi-thousand-page PDFs) blowing up downstream
// chunking and indexing. The KB indexer already handles chunking below this.
export const MAX_EXTRACTED_TEXT_CHARS = 1_048_576; // 1 MB of text

export function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS), truncated: true };
}
