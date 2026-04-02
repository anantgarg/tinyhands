/**
 * Content conversion utilities for the Docs module.
 *
 * Agents write/read markdown; the dashboard uses Slate/Plate JSON.
 * Sheets are read/written as CSV by agents; stored as sparse JSONB.
 */
import type { CellData } from '../../types';

// ── Markdown ↔ Slate JSON ──

/**
 * Convert markdown text to a simple Slate-compatible JSON document.
 * This produces a flat block structure suitable for Plate editor consumption.
 */
export function markdownToSlateJson(markdown: string): Record<string, unknown> {
  const lines = markdown.split('\n');
  const children: any[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    // Handle code block fences
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        // Closing fence — flush accumulated code lines as a single code_block
        children.push({ type: 'code_block', children: [{ text: codeLines.join('\n') }] });
        inCodeBlock = false;
        codeLines = [];
      }
      continue;
    }

    // Accumulate lines inside a code block
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('### ')) {
      children.push({ type: 'h3', children: [{ text: line.slice(4) }] });
    } else if (line.startsWith('## ')) {
      children.push({ type: 'h2', children: [{ text: line.slice(3) }] });
    } else if (line.startsWith('# ')) {
      children.push({ type: 'h1', children: [{ text: line.slice(2) }] });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      children.push({ type: 'ul', children: [{ type: 'li', children: [{ text: line.slice(2) }] }] });
    } else if (/^\d+\.\s/.test(line)) {
      children.push({ type: 'ol', children: [{ type: 'li', children: [{ text: line.replace(/^\d+\.\s/, '') }] }] });
    } else if (line.startsWith('> ')) {
      children.push({ type: 'blockquote', children: [{ text: line.slice(2) }] });
    } else if (line.startsWith('---') || line.startsWith('***')) {
      children.push({ type: 'hr', children: [{ text: '' }] });
    } else if (line.trim() === '') {
      // Skip empty lines between blocks
      continue;
    } else {
      // Parse inline formatting
      children.push({ type: 'p', children: parseInlineFormatting(line) });
    }
  }

  // Handle unclosed code block (no closing fence)
  if (inCodeBlock && codeLines.length > 0) {
    children.push({ type: 'code_block', children: [{ text: codeLines.join('\n') }] });
  }

  if (children.length === 0) {
    children.push({ type: 'p', children: [{ text: '' }] });
  }

  return { type: 'doc', children };
}

function parseInlineFormatting(text: string): any[] {
  const result: any[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) result.push({ text: boldMatch[1] });
      result.push({ text: boldMatch[2], bold: true });
      remaining = boldMatch[3];
      continue;
    }

    // Italic *text*
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)/s);
    if (italicMatch) {
      if (italicMatch[1]) result.push({ text: italicMatch[1] });
      result.push({ text: italicMatch[2], italic: true });
      remaining = italicMatch[3];
      continue;
    }

    // Code `text`
    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) result.push({ text: codeMatch[1] });
      result.push({ text: codeMatch[2], code: true });
      remaining = codeMatch[3];
      continue;
    }

    // Plain text
    result.push({ text: remaining });
    break;
  }

  return result.length > 0 ? result : [{ text }];
}

/**
 * Convert Slate JSON document tree to markdown text.
 */
export function slateJsonToMarkdown(doc: Record<string, unknown>): string {
  const children = (doc as any).children || [];
  return children.map(blockToMarkdown).filter(Boolean).join('\n\n');
}

function blockToMarkdown(node: any): string {
  if (!node) return '';
  const text = childrenToText(node.children || []);

  switch (node.type) {
    case 'h1': return `# ${text}`;
    case 'h2': return `## ${text}`;
    case 'h3': return `### ${text}`;
    case 'blockquote': return `> ${text}`;
    case 'code_block': return `\`\`\`\n${text}\n\`\`\``;
    case 'hr': return '---';
    case 'ul':
      return (node.children || []).map((li: any) => `- ${childrenToText(li.children || [])}`).join('\n');
    case 'ol':
      return (node.children || []).map((li: any, i: number) => `${i + 1}. ${childrenToText(li.children || [])}`).join('\n');
    case 'p':
    default:
      return text;
  }
}

function childrenToText(children: any[]): string {
  return children.map(inlineToText).join('');
}

function inlineToText(node: any): string {
  if (typeof node.text === 'string') {
    let t = node.text;
    if (node.bold) t = `**${t}**`;
    if (node.italic) t = `*${t}*`;
    if (node.code) t = `\`${t}\``;
    return t;
  }
  if (node.children) return childrenToText(node.children);
  return '';
}

// ── CSV ↔ Cell Data ──

/**
 * Convert sparse cell data to CSV string.
 */
export function cellDataToCsv(data: Record<string, CellData>): string {
  if (Object.keys(data).length === 0) return '';

  // Find dimensions
  let maxRow = 0;
  let maxCol = 0;
  for (const key of Object.keys(data)) {
    const parsed = parseCellRef(key);
    if (parsed) {
      if (parsed.row > maxRow) maxRow = parsed.row;
      if (parsed.col > maxCol) maxCol = parsed.col;
    }
  }

  const rows: string[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const ref = columnLetter(c - 1) + r;
      const cell = data[ref];
      const value = cell?.v ?? '';
      // CSV-escape values containing commas, quotes, or newlines
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        cells.push(`"${str.replace(/"/g, '""')}"`);
      } else {
        cells.push(str);
      }
    }
    rows.push(cells.join(','));
  }
  return rows.join('\n');
}

/**
 * Parse CSV string into sparse cell data.
 */
export function csvToCellData(csv: string): Record<string, CellData> {
  const data: Record<string, CellData> = {};
  const rows = parseCsvRows(csv);

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const value = rows[r][c];
      if (value === '') continue; // skip empty cells
      const ref = columnLetter(c) + (r + 1);
      // Try to detect number type
      const num = Number(value);
      if (!isNaN(num) && value.trim() !== '') {
        data[ref] = { v: num, t: 'number' };
      } else {
        data[ref] = { v: value, t: 'string' };
      }
    }
  }
  return data;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(cell);
        cell = '';
      } else if (ch === '\n' || (ch === '\r' && csv[i + 1] === '\n')) {
        current.push(cell);
        rows.push(current);
        current = [];
        cell = '';
        if (ch === '\r') i++;
      } else {
        cell += ch;
      }
    }
  }
  // Last cell/row
  current.push(cell);
  if (current.length > 0 && current.some(c => c !== '')) {
    rows.push(current);
  }
  return rows;
}

// ── Extract text for search indexing ──

/**
 * Extract searchable plain text from a Slate JSON document.
 */
export function extractTextForSearch(content: Record<string, unknown>): string {
  const children = (content as any).children || [];
  return children.map(extractNodeText).filter(Boolean).join(' ');
}

function extractNodeText(node: any): string {
  if (typeof node.text === 'string') return node.text;
  if (node.children) return node.children.map(extractNodeText).join(' ');
  return '';
}

// ── Helpers ──

function parseCellRef(ref: string): { col: number; row: number } | null {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  let col = 0;
  for (let i = 0; i < match[1].length; i++) {
    col = col * 26 + (match[1].charCodeAt(i) - 64);
  }
  return { col, row: parseInt(match[2], 10) };
}

function columnLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
