import pdfParse from 'pdf-parse';
import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

export async function parsePdf(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const result = await pdfParse(input.bytes);
  const { text, truncated } = truncateText(result.text || '');
  if (truncated) warnings.push(`${input.filename}: PDF too large — truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'pdf-parse', pages: result.numpages } };
}
