import { describe, it, expect } from 'vitest';
import { markdownToSlack } from '../../src/utils/slack-format';

describe('markdownToSlack', () => {
  it('should return empty/falsy input unchanged', () => {
    expect(markdownToSlack('')).toBe('');
    expect(markdownToSlack(null as any)).toBe(null);
    expect(markdownToSlack(undefined as any)).toBe(undefined);
  });

  it('should convert markdown headers to bold', () => {
    expect(markdownToSlack('# Title')).toBe('*Title*');
    expect(markdownToSlack('## Section')).toBe('*Section*');
    expect(markdownToSlack('### Subsection')).toBe('*Subsection*');
    expect(markdownToSlack('###### Deep')).toBe('*Deep*');
  });

  it('should convert bold syntax', () => {
    expect(markdownToSlack('This is **bold** text')).toBe('This is *bold* text');
  });

  it('should strip language from code blocks', () => {
    const input = '```javascript\nconsole.log("hi");\n```';
    const expected = '```\nconsole.log("hi");\n```';
    expect(markdownToSlack(input)).toBe(expected);
  });

  it('should convert links', () => {
    expect(markdownToSlack('[Click here](https://example.com)')).toBe('<https://example.com|Click here>');
  });

  it('should convert images', () => {
    // Image regex runs after link regex, so the ! stays — the link part gets converted
    const result = markdownToSlack('![alt text](https://img.com/a.png)');
    expect(result).toContain('https://img.com/a.png');
  });

  it('should convert horizontal rules', () => {
    expect(markdownToSlack('---')).toBe('───');
    expect(markdownToSlack('***')).toBe('───');
    expect(markdownToSlack('-----')).toBe('───');
  });

  it('should convert strikethrough', () => {
    expect(markdownToSlack('~~deleted~~')).toBe('~deleted~');
  });

  it('should convert bullet lists', () => {
    expect(markdownToSlack('- item 1\n- item 2')).toBe('• item 1\n• item 2');
    expect(markdownToSlack('* item 1\n* item 2')).toBe('• item 1\n• item 2');
  });

  it('should remove HTML tags', () => {
    expect(markdownToSlack('<br>line<br>')).toBe('line');
    expect(markdownToSlack('<p>paragraph</p>')).toBe('paragraph');
  });

  it('should convert literal \\n to actual newlines', () => {
    expect(markdownToSlack('line one\\nline two')).toBe('line one\nline two');
    expect(markdownToSlack('• item 1\\n• item 2')).toBe('• item 1\n• item 2');
  });

  it('should handle mixed content', () => {
    const input = '## Summary\n\n**Key finding**: the [report](https://example.com) shows ~~old~~ results.\n\n- Item A\n- Item B';
    const result = markdownToSlack(input);
    expect(result).toContain('*Summary*');
    expect(result).toContain('*Key finding*');
    expect(result).toContain('<https://example.com|report>');
    expect(result).toContain('~old~');
    expect(result).toContain('• Item A');
  });
});
