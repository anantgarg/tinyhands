import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readdirSync: (...args: any[]) => mockReaddirSync(...args),
    statSync: (...args: any[]) => mockStatSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
  },
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  parseGitHubUri,
  cloneRepo,
  readRepoFiles,
  getChangedFiles,
  pullLatest,
} from '../../src/modules/sources/github';

// ── Tests ──

describe('GitHub Source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── parseGitHubUri ──

  describe('parseGitHubUri', () => {
    it('should parse owner/repo shorthand', () => {
      const result = parseGitHubUri('owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: undefined, path: undefined });
    });

    it('should parse full HTTPS URL', () => {
      const result = parseGitHubUri('https://github.com/acme/project');
      expect(result).toEqual({ owner: 'acme', repo: 'project', branch: undefined, path: undefined });
    });

    it('should strip .git suffix', () => {
      const result = parseGitHubUri('https://github.com/owner/repo.git');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: undefined, path: undefined });
    });

    it('should parse URL with tree (branch)', () => {
      const result = parseGitHubUri('https://github.com/owner/repo/tree/main');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main', path: undefined });
    });

    it('should parse URL with tree (branch + path)', () => {
      const result = parseGitHubUri('https://github.com/owner/repo/tree/develop/src/lib');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'develop', path: 'src/lib' });
    });

    it('should parse URL with blob (file path)', () => {
      const result = parseGitHubUri('https://github.com/owner/repo/blob/main/README.md');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main', path: 'README.md' });
    });

    it('should handle github.com prefix without protocol', () => {
      const result = parseGitHubUri('github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: undefined, path: undefined });
    });

    it('should handle URL with http (not https)', () => {
      const result = parseGitHubUri('http://github.com/owner/repo');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: undefined, path: undefined });
    });

    it('should handle nested path with multiple segments', () => {
      const result = parseGitHubUri('https://github.com/owner/repo/tree/main/src/components/ui');
      expect(result).toEqual({ owner: 'owner', repo: 'repo', branch: 'main', path: 'src/components/ui' });
    });
  });

  // ── cloneRepo ──

  describe('cloneRepo', () => {
    it('should clone without token using HTTPS URL', () => {
      mockExecSync.mockReturnValue('');
      cloneRepo('owner', 'repo', '/tmp/clone');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git clone --depth 1  https://github.com/owner/repo.git /tmp/clone',
        expect.objectContaining({ timeout: 60000, stdio: 'pipe' }),
      );
    });

    it('should include token in URL when provided', () => {
      mockExecSync.mockReturnValue('');
      cloneRepo('owner', 'repo', '/tmp/clone', 'ghp_token123');

      const cmd = mockExecSync.mock.calls[0][0];
      expect(cmd).toContain('https://ghp_token123@github.com/owner/repo.git');
    });

    it('should include branch arg when provided', () => {
      mockExecSync.mockReturnValue('');
      cloneRepo('owner', 'repo', '/tmp/clone', undefined, 'develop');

      const cmd = mockExecSync.mock.calls[0][0];
      expect(cmd).toContain('--branch develop');
    });

    it('should throw auth error on 401 stderr', () => {
      mockExecSync.mockImplementation(() => {
        const err: any = new Error('clone failed');
        err.stderr = 'remote: Invalid credentials 401';
        throw err;
      });

      expect(() => cloneRepo('owner', 'repo', '/tmp/clone')).toThrow(
        'GitHub authentication failed for owner/repo',
      );
    });

    it('should throw auth error on 403 stderr', () => {
      mockExecSync.mockImplementation(() => {
        const err: any = new Error('clone failed');
        err.stderr = 'remote: 403 Forbidden';
        throw err;
      });

      expect(() => cloneRepo('owner', 'repo', '/tmp/clone')).toThrow(
        'GitHub authentication failed for owner/repo',
      );
    });

    it('should throw generic error for other failures', () => {
      mockExecSync.mockImplementation(() => {
        const err: any = new Error('network timeout');
        err.stderr = 'fatal: unable to access';
        throw err;
      });

      expect(() => cloneRepo('owner', 'repo', '/tmp/clone')).toThrow(
        'Failed to clone owner/repo',
      );
    });

    it('should throw generic error when stderr is undefined', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('unexpected error');
      });

      expect(() => cloneRepo('owner', 'repo', '/tmp/clone')).toThrow(
        'Failed to clone owner/repo',
      );
    });
  });

  // ── readRepoFiles ──

  describe('readRepoFiles', () => {
    it('should return empty array if base dir does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const result = readRepoFiles('/tmp/repo');
      expect(result).toEqual([]);
    });

    it('should read text files from a flat directory', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
        { name: 'README.md', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 500 });
      mockReadFileSync.mockReturnValue('file content');

      const result = readRepoFiles('/tmp/repo');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ path: 'index.ts', content: 'file content' });
      expect(result[1]).toEqual({ path: 'README.md', content: 'file content' });
    });

    it('should skip node_modules and .git directories', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: '.git', isDirectory: () => true, isFile: () => false },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ]);

      // For 'src' subdirectory, return empty
      mockReaddirSync.mockReturnValueOnce([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: '.git', isDirectory: () => true, isFile: () => false },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ]).mockReturnValueOnce([]);

      const result = readRepoFiles('/tmp/repo');
      // node_modules and .git (starts with '.') are both skipped
      expect(result).toEqual([]);
    });

    it('should skip non-text files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'image.png', isDirectory: () => false, isFile: () => true },
        { name: 'archive.zip', isDirectory: () => false, isFile: () => true },
      ]);

      const result = readRepoFiles('/tmp/repo');
      expect(result).toEqual([]);
    });

    it('should skip files larger than 100KB', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'large.ts', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 200 * 1024 }); // 200KB

      const result = readRepoFiles('/tmp/repo');
      expect(result).toEqual([]);
    });

    it('should handle subPath parameter', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'app.ts', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 100 });
      mockReadFileSync.mockReturnValue('content');

      const result = readRepoFiles('/tmp/repo', 'src');

      // existsSync called with joined path
      expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining('src'));
    });

    it('should skip unreadable files gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'readable.ts', isDirectory: () => false, isFile: () => true },
        { name: 'broken.ts', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 100 });
      mockReadFileSync
        .mockReturnValueOnce('good content')
        .mockImplementationOnce(() => { throw new Error('EACCES'); });

      const result = readRepoFiles('/tmp/repo');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('good content');
    });

    it('should include files with no extension (extensionless text files)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'Makefile', isDirectory: () => false, isFile: () => true },
      ]);
      mockStatSync.mockReturnValue({ size: 100 });
      mockReadFileSync.mockReturnValue('all: build');

      const result = readRepoFiles('/tmp/repo');
      // Makefile is in TEXT_EXTENSIONS set, and files with ext === '' are also included
      expect(result).toHaveLength(1);
    });

    it('should skip directories starting with dot', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: '.hidden', isDirectory: () => true, isFile: () => false },
      ]);

      const result = readRepoFiles('/tmp/repo');
      expect(result).toEqual([]);
    });
  });

  // ── getChangedFiles ──

  describe('getChangedFiles', () => {
    it('should return unique list of changed file paths', () => {
      const gitOutput = 'src/index.ts\nREADME.md\nsrc/index.ts\n';
      mockExecSync.mockReturnValue(gitOutput);

      const since = new Date('2025-01-01');
      const result = getChangedFiles('/tmp/repo', since);

      expect(result).toEqual(['src/index.ts', 'README.md']);
    });

    it('should pass correct git log command with since date', () => {
      mockExecSync.mockReturnValue('');
      const since = new Date('2025-06-15T12:00:00Z');
      getChangedFiles('/tmp/repo', since);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--since="2025-06-15T12:00:00.000Z"'),
        expect.objectContaining({ cwd: '/tmp/repo', timeout: 10000 }),
      );
    });

    it('should return empty array on git command failure', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
      const result = getChangedFiles('/tmp/repo', new Date());
      expect(result).toEqual([]);
    });

    it('should filter out empty lines', () => {
      mockExecSync.mockReturnValue('\n\nfile.ts\n\n');
      const result = getChangedFiles('/tmp/repo', new Date());
      expect(result).toEqual(['file.ts']);
    });
  });

  // ── pullLatest ──

  describe('pullLatest', () => {
    it('should return true when new changes are pulled', () => {
      mockExecSync.mockReturnValue('Updating abc123..def456\nFast-forward\n');
      expect(pullLatest('/tmp/repo')).toBe(true);
    });

    it('should return false when already up to date', () => {
      mockExecSync.mockReturnValue('Already up to date.\n');
      expect(pullLatest('/tmp/repo')).toBe(false);
    });

    it('should call git pull --ff-only with correct options', () => {
      mockExecSync.mockReturnValue('Already up to date.');
      pullLatest('/tmp/repo');

      expect(mockExecSync).toHaveBeenCalledWith(
        'git pull --ff-only',
        expect.objectContaining({ cwd: '/tmp/repo', timeout: 30000 }),
      );
    });

    it('should return false on error', () => {
      mockExecSync.mockImplementation(() => { throw new Error('merge conflict'); });
      expect(pullLatest('/tmp/repo')).toBe(false);
    });
  });
});
