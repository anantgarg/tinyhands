/**
 * Client-side content conversion utilities for the Docs module.
 *
 * These are pure-function ports of the server-side converters in
 * src/modules/docs/convert.ts, used by the dashboard editors to
 * round-trip between Slate JSON (storage format) and markdown
 * (editor format).
 */

// ── Markdown → Slate JSON ──

/**
 * Convert markdown text to a simple Slate-compatible JSON document.
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
        children.push({ type: 'code_block', children: [{ text: codeLines.join('\n') }] });
        inCodeBlock = false;
        codeLines = [];
      }
      continue;
    }

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
      continue;
    } else {
      children.push({ type: 'p', children: parseInlineFormatting(line) });
    }
  }

  // Handle unclosed code block
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
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)/s);
    if (boldMatch) {
      if (boldMatch[1]) result.push({ text: boldMatch[1] });
      result.push({ text: boldMatch[2], bold: true });
      remaining = boldMatch[3];
      continue;
    }

    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*(.*)/s);
    if (italicMatch) {
      if (italicMatch[1]) result.push({ text: italicMatch[1] });
      result.push({ text: italicMatch[2], italic: true });
      remaining = italicMatch[3];
      continue;
    }

    const codeMatch = remaining.match(/^(.*?)`(.+?)`(.*)/s);
    if (codeMatch) {
      if (codeMatch[1]) result.push({ text: codeMatch[1] });
      result.push({ text: codeMatch[2], code: true });
      remaining = codeMatch[3];
      continue;
    }

    result.push({ text: remaining });
    break;
  }

  return result.length > 0 ? result : [{ text }];
}

// ── Slate JSON → Markdown ──

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
