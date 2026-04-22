import mammoth from 'mammoth';
import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

export async function parseDocx(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const result = await mammoth.extractRawText({ buffer: input.bytes });
  for (const m of result.messages || []) {
    if (m.type === 'warning' || m.type === 'error') warnings.push(`${input.filename}: ${m.message}`);
  }
  const { text, truncated } = truncateText(result.value || '');
  if (truncated) warnings.push(`${input.filename}: content truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'docx' } };
}
