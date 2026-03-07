import { describe, it, expect } from 'vitest';

describe('Source Type Detection', () => {
  function detectSourceType(input: string): string {
    if (/github\.com/i.test(input) || /^[\w-]+\/[\w-]+$/.test(input)) return 'github';
    if (/docs\.google\.com|drive\.google\.com/i.test(input)) return 'google_drive';
    if (input.startsWith('/') || input.startsWith('./')) return 'local';
    return 'slack_upload';
  }

  it('should detect GitHub URLs', () => {
    expect(detectSourceType('https://github.com/owner/repo')).toBe('github');
    expect(detectSourceType('owner/repo')).toBe('github');
  });

  it('should detect Google Drive URLs', () => {
    expect(detectSourceType('https://docs.google.com/spreadsheets/d/abc123')).toBe('google_drive');
    expect(detectSourceType('https://drive.google.com/file/d/abc')).toBe('google_drive');
  });

  it('should detect local paths', () => {
    expect(detectSourceType('/home/user/file.txt')).toBe('local');
    expect(detectSourceType('./relative/path')).toBe('local');
  });

  it('should default to slack_upload', () => {
    expect(detectSourceType('some random text')).toBe('slack_upload');
  });
});

describe('FTS Query Sanitization', () => {
  function sanitizeFtsQuery(query: string): string {
    return query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 10)
      .join(' OR ');
  }

  it('should remove special characters', () => {
    expect(sanitizeFtsQuery('hello (world) [test]')).toBe('hello OR world OR test');
  });

  it('should filter short words', () => {
    expect(sanitizeFtsQuery('a to the function')).toBe('the OR function');
  });

  it('should limit to 10 terms', () => {
    const longQuery = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const result = sanitizeFtsQuery(longQuery);
    expect(result.split(' OR ')).toHaveLength(10);
  });

  it('should handle empty queries', () => {
    expect(sanitizeFtsQuery('')).toBe('');
  });
});

describe('GitHub URI Parsing', () => {
  function parseGitHubUri(uri: string): { owner: string; repo: string; branch: string } | null {
    const match = uri.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#(.+))?$/);
    if (!match) {
      const shortMatch = uri.match(/^([\w.-]+)\/([\w.-]+?)(?:#(.+))?$/);
      if (!shortMatch) return null;
      return { owner: shortMatch[1], repo: shortMatch[2], branch: shortMatch[3] || 'main' };
    }
    return { owner: match[1], repo: match[2], branch: match[3] || 'main' };
  }

  it('should parse full GitHub URLs', () => {
    const result = parseGitHubUri('https://github.com/owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main' });
  });

  it('should parse short form', () => {
    const result = parseGitHubUri('owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main' });
  });

  it('should parse with branch', () => {
    const result = parseGitHubUri('owner/repo#develop');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'develop' });
  });

  it('should handle .git suffix', () => {
    const result = parseGitHubUri('https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main' });
  });
});
