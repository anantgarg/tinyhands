import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

/**
 * Pass-through parser for text, markdown, CSV, TSV, JSON, and similar
 * already-textual formats. We decode the buffer as UTF-8 and return as-is.
 */
export async function parsePlainText(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const raw = input.bytes.toString('utf8');
  const { text, truncated } = truncateText(raw);
  if (truncated) warnings.push(`${input.filename}: file too large — truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'plain-text' } };
}
