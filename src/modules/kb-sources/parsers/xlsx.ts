import * as XLSX from 'xlsx';
import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

export async function parseXlsx(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const workbook = XLSX.read(input.bytes, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    parts.push(`# Sheet: ${sheetName}\n${csv}`);
  }
  const { text, truncated } = truncateText(parts.join('\n\n'));
  if (truncated) warnings.push(`${input.filename}: spreadsheet too large — truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'xlsx', sheets: workbook.SheetNames.length } };
}
