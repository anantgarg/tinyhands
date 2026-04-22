import { htmlToText } from 'html-to-text';
import type { ParseInput, ParseResult } from './types';
import { truncateText } from './types';

export async function parseHtml(input: ParseInput): Promise<ParseResult> {
  const warnings: string[] = [];
  const source = input.bytes.toString('utf8');
  const raw = htmlToText(source, {
    wordwrap: false,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
      // Preserve heading casing — the default html-to-text behavior upper-cases
      // h1/h2, which corrupts full-text search matches on proper nouns and
      // product names.
      { selector: 'h1', options: { uppercase: false } },
      { selector: 'h2', options: { uppercase: false } },
      { selector: 'h3', options: { uppercase: false } },
      { selector: 'h4', options: { uppercase: false } },
      { selector: 'h5', options: { uppercase: false } },
      { selector: 'h6', options: { uppercase: false } },
    ],
  });
  const { text, truncated } = truncateText(raw);
  if (truncated) warnings.push(`${input.filename}: HTML too large — truncated to ${text.length.toLocaleString()} chars`);
  return { text, warnings, metadata: { parser: 'html-to-text' } };
}
