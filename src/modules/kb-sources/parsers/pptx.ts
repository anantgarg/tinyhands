import { parseOfficeAsync } from 'officeparser';
import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

/**
 * Parse PowerPoint (.pptx) and OpenDocument presentation (.odp) files.
 * officeparser also handles .odt and .ods; we use format-specific parsers
 * for those where a higher-fidelity library is available (mammoth for docx,
 * SheetJS for spreadsheets).
 */
export async function parsePptx(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const raw = await parseOfficeAsync(input.bytes);
  const { text, truncated } = truncateText(raw || '');
  if (truncated) warnings.push(`${input.filename}: slides too large — truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'pptx' } };
}
