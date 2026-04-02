import { describe, it, expect } from 'vitest';
import {
  markdownToSlateJson,
  slateJsonToMarkdown,
  cellDataToCsv,
  csvToCellData,
  extractTextForSearch,
} from '../../src/modules/docs/convert';

describe('markdownToSlateJson', () => {
  it('should convert h1 heading', () => {
    const result = markdownToSlateJson('# Hello') as any;
    const h1 = result.children.find((n: any) => n.type === 'h1');
    expect(h1).toBeDefined();
    expect(h1.children[0].text).toBe('Hello');
  });

  it('should convert h2 heading', () => {
    const result = markdownToSlateJson('## Subtitle') as any;
    const h2 = result.children.find((n: any) => n.type === 'h2');
    expect(h2).toBeDefined();
    expect(h2.children[0].text).toBe('Subtitle');
  });

  it('should convert h3 heading', () => {
    const result = markdownToSlateJson('### Section') as any;
    const h3 = result.children.find((n: any) => n.type === 'h3');
    expect(h3).toBeDefined();
    expect(h3.children[0].text).toBe('Section');
  });

  it('should convert paragraphs', () => {
    const result = markdownToSlateJson('Just a paragraph.') as any;
    const p = result.children.find((n: any) => n.type === 'p');
    expect(p).toBeDefined();
    expect(p.children[0].text).toBe('Just a paragraph.');
  });

  it('should convert unordered lists', () => {
    const md = '- Item A\n- Item B';
    const result = markdownToSlateJson(md) as any;
    const lists = result.children.filter((n: any) => n.type === 'ul');
    expect(lists.length).toBe(2);
  });

  it('should convert ordered lists', () => {
    const md = '1. First\n2. Second';
    const result = markdownToSlateJson(md) as any;
    const lists = result.children.filter((n: any) => n.type === 'ol');
    expect(lists.length).toBe(2);
  });

  it('should convert blockquotes', () => {
    const result = markdownToSlateJson('> A quote') as any;
    const bq = result.children.find((n: any) => n.type === 'blockquote');
    expect(bq).toBeDefined();
    expect(bq.children[0].text).toBe('A quote');
  });

  it('should convert code blocks with multi-line content', () => {
    const result = markdownToSlateJson('```\nconst x = 1;\nconst y = 2;\n```') as any;
    const code = result.children.find((n: any) => n.type === 'code_block');
    expect(code).toBeDefined();
    expect(code.children[0].text).toBe('const x = 1;\nconst y = 2;');
  });

  it('should convert empty code blocks', () => {
    const result = markdownToSlateJson('```\n```') as any;
    const code = result.children.find((n: any) => n.type === 'code_block');
    expect(code).toBeDefined();
    expect(code.children[0].text).toBe('');
  });

  it('should handle unclosed code blocks', () => {
    const result = markdownToSlateJson('```\nsome code\nmore code') as any;
    const code = result.children.find((n: any) => n.type === 'code_block');
    expect(code).toBeDefined();
    expect(code.children[0].text).toBe('some code\nmore code');
  });

  it('should not treat lines inside code block as other block types', () => {
    const result = markdownToSlateJson('```\n# Not a heading\n- Not a list\n```') as any;
    expect(result.children).toHaveLength(1);
    expect(result.children[0].type).toBe('code_block');
    expect(result.children[0].children[0].text).toBe('# Not a heading\n- Not a list');
  });

  it('should convert horizontal rules', () => {
    const result = markdownToSlateJson('---') as any;
    const hr = result.children.find((n: any) => n.type === 'hr');
    expect(hr).toBeDefined();
  });

  it('should convert inline bold', () => {
    const result = markdownToSlateJson('Some **bold** text') as any;
    const p = result.children.find((n: any) => n.type === 'p');
    const boldNode = p.children.find((n: any) => n.bold === true);
    expect(boldNode).toBeDefined();
    expect(boldNode.text).toBe('bold');
  });

  it('should convert inline italic', () => {
    const result = markdownToSlateJson('Some *italic* text') as any;
    const p = result.children.find((n: any) => n.type === 'p');
    const italicNode = p.children.find((n: any) => n.italic === true);
    expect(italicNode).toBeDefined();
    expect(italicNode.text).toBe('italic');
  });

  it('should convert inline code', () => {
    const result = markdownToSlateJson('Use `code` here') as any;
    const p = result.children.find((n: any) => n.type === 'p');
    const codeNode = p.children.find((n: any) => n.code === true);
    expect(codeNode).toBeDefined();
    expect(codeNode.text).toBe('code');
  });

  it('should handle empty input', () => {
    const result = markdownToSlateJson('') as any;
    expect(result).toBeDefined();
    expect(result.type).toBe('doc');
    expect(result.children).toBeDefined();
    expect(result.children.length).toBeGreaterThan(0);
  });
});

describe('slateJsonToMarkdown', () => {
  it('should roundtrip a heading', () => {
    const slate = markdownToSlateJson('# Title');
    const md = slateJsonToMarkdown(slate);
    expect(md.trim()).toBe('# Title');
  });

  it('should roundtrip a paragraph', () => {
    const slate = markdownToSlateJson('Hello world');
    const md = slateJsonToMarkdown(slate);
    expect(md.trim()).toBe('Hello world');
  });

  it('should convert all block types', () => {
    const slate = {
      type: 'doc',
      children: [
        { type: 'h1', children: [{ text: 'Heading 1' }] },
        { type: 'h2', children: [{ text: 'Heading 2' }] },
        { type: 'p', children: [{ text: 'A paragraph.' }] },
        { type: 'blockquote', children: [{ text: 'A quote' }] },
        { type: 'hr', children: [{ text: '' }] },
      ],
    };
    const md = slateJsonToMarkdown(slate);
    expect(md).toContain('# Heading 1');
    expect(md).toContain('## Heading 2');
    expect(md).toContain('A paragraph.');
    expect(md).toContain('> A quote');
    expect(md).toContain('---');
  });

  it('should roundtrip code blocks with multi-line content', () => {
    const md = '```\nfunction hello() {\n  return "world";\n}\n```';
    const slate = markdownToSlateJson(md);
    const result = slateJsonToMarkdown(slate);
    expect(result).toBe(md);
  });

  it('should convert code_block node to fenced code block', () => {
    const slate = {
      type: 'doc',
      children: [
        { type: 'code_block', children: [{ text: 'line1\nline2' }] },
      ],
    };
    const md = slateJsonToMarkdown(slate);
    expect(md).toBe('```\nline1\nline2\n```');
  });

  it('should preserve inline formatting', () => {
    const slate = {
      type: 'doc',
      children: [
        {
          type: 'p',
          children: [
            { text: 'Has ' },
            { text: 'bold', bold: true },
            { text: ' and ' },
            { text: 'italic', italic: true },
            { text: ' and ' },
            { text: 'code', code: true },
          ],
        },
      ],
    };
    const md = slateJsonToMarkdown(slate);
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
    expect(md).toContain('`code`');
  });
});

describe('cellDataToCsv', () => {
  it('should convert a simple grid', () => {
    const data = {
      A1: { v: 'Name' as string | number | boolean },
      B1: { v: 'Age' as string | number | boolean },
      A2: { v: 'Alice' as string | number | boolean },
      B2: { v: 30 as string | number | boolean },
    };
    const csv = cellDataToCsv(data);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('Name,Age');
    expect(lines[1]).toBe('Alice,30');
  });

  it('should return empty string for empty data', () => {
    const csv = cellDataToCsv({});
    expect(csv).toBe('');
  });

  it('should escape values with commas and quotes', () => {
    const data = {
      A1: { v: 'Hello, World' as string | number | boolean },
      B1: { v: 'She said "hi"' as string | number | boolean },
    };
    const csv = cellDataToCsv(data);
    expect(csv).toContain('"Hello, World"');
    expect(csv).toContain('"She said ""hi"""');
  });

  it('should handle sparse data with gaps', () => {
    const data = {
      A1: { v: 'Top left' as string | number | boolean },
      C3: { v: 'Deep cell' as string | number | boolean },
    };
    const csv = cellDataToCsv(data);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('Top left');
    expect(lines[2]).toContain('Deep cell');
  });
});

describe('csvToCellData', () => {
  it('should parse simple CSV', () => {
    const csv = 'Name,Age\nAlice,30\nBob,25';
    const data = csvToCellData(csv);
    expect(data.A1.v).toBe('Name');
    expect(data.B1.v).toBe('Age');
    expect(data.A2.v).toBe('Alice');
  });

  it('should detect numbers', () => {
    const csv = 'val\n42\n3.14\n-7';
    const data = csvToCellData(csv);
    expect(data.A2.v).toBe(42);
    expect(data.A3.v).toBe(3.14);
    expect(data.A4.v).toBe(-7);
  });

  it('should handle quoted fields', () => {
    const csv = '"Hello, World","She said ""hi"""\nplain,text';
    const data = csvToCellData(csv);
    expect(data.A1.v).toBe('Hello, World');
    expect(data.B1.v).toBe('She said "hi"');
  });

  it('should return empty object for empty string', () => {
    const data = csvToCellData('');
    expect(Object.keys(data)).toHaveLength(0);
  });
});

describe('extractTextForSearch', () => {
  it('should extract text from nested Slate structure', () => {
    const doc = {
      children: [
        { type: 'h1', children: [{ text: 'Title' }] },
        {
          type: 'p',
          children: [
            { text: 'Hello ' },
            { text: 'world', bold: true },
            { text: '.' },
          ],
        },
        { type: 'p', children: [{ text: 'Another paragraph here.' }] },
      ],
    };
    const text = extractTextForSearch(doc);
    expect(text).toContain('Title');
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).toContain('Another paragraph here.');
  });

  it('should handle empty content', () => {
    const doc = { children: [] };
    const text = extractTextForSearch(doc);
    expect(text.trim()).toBe('');
  });
});
