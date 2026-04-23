import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

/**
 * Minimal RTF text extractor. Handles the common subset of RTF control
 * words and escape sequences well enough for typical policy/memo documents
 * exported from Word. We intentionally do not pull in a dedicated rtf-parser
 * npm package — the popular options are unmaintained and this inline
 * implementation is good enough for KB ingestion. Use Reducto if you need
 * higher-fidelity RTF extraction.
 */
export async function parseRtf(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const source = input.bytes.toString('utf8');
  const text = stripRtf(source);
  const { text: truncated, truncated: wasTruncated } = truncateText(text);
  if (wasTruncated) warnings.push(`${input.filename}: RTF too large — truncated to ${truncated.length.toLocaleString()} chars`);
  return { text: truncated, warnings, metadata: { parser: 'rtf-inline' } };
}

function stripRtf(rtf: string): string {
  let out = rtf;
  // Drop \binN ...binary blobs and their payload bytes
  out = out.replace(/\\bin\d+\s[\s\S]*?(?=\\)/g, ' ');
  // Drop any group that holds metadata we don't want in text (fonts, colors, stylesheets, info, pict, header/footer, etc.)
  out = stripGroups(out, ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl']);
  // Drop RTF ignorable destinations `{\*\<name> ... }` — these carry
  // extension metadata readers should skip (e.g. `{\*\generator Word}`).
  out = stripIgnorableDestinations(out);
  // Unicode escapes \uNNNN? — take the number, emit the codepoint, drop the fallback char
  out = out.replace(/\\u(-?\d+)\??/g, (_m, n) => {
    const code = Number(n);
    const cp = code < 0 ? 65536 + code : code;
    try { return String.fromCodePoint(cp); } catch { return ''; }
  });
  // Hex escapes \'hh → single byte
  out = out.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hh) => String.fromCharCode(parseInt(hh, 16)));
  // Paragraph / line breaks
  out = out.replace(/\\par\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '\t');
  // Drop remaining control words (with optional numeric parameter and trailing space)
  out = out.replace(/\\[a-zA-Z]+-?\d*\s?/g, '');
  // Drop escaped braces / backslashes
  out = out.replace(/\\([\\{}])/g, '$1');
  // Finally, drop remaining braces
  out = out.replace(/[{}]/g, '');
  // Collapse whitespace
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function stripGroups(rtf: string, destNames: string[]): string {
  let out = rtf;
  for (const name of destNames) {
    // Match {\destname ...nested groups...}. The optional `\*` prefix (as in
    // `{\*\destname ...}`) marks an ignorable destination.
    const pattern = new RegExp(`\\{(?:\\\\\\*)?\\\\${name}\\b`, 'g');
    out = eatGroups(out, pattern);
  }
  return out;
}

function stripIgnorableDestinations(rtf: string): string {
  // RTF ignorable-destinations — `{\*\whatever ...}`. Catch any destname.
  const pattern = /\{\\\*\\[A-Za-z]+\b/g;
  return eatGroups(rtf, pattern);
}

function eatGroups(rtf: string, pattern: RegExp): string {
  let out = rtf;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(out)) !== null) {
    const start = match.index;
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < out.length && depth > 0) {
      const c = out[i];
      if (c === '\\' && (out[i + 1] === '{' || out[i + 1] === '}' || out[i + 1] === '\\')) { i += 2; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    out = out.slice(0, start) + out.slice(i);
    pattern.lastIndex = start;
  }
  return out;
}
