import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger';

export interface GitHubRepoFiles {
  path: string;
  content: string;
}

export function parseGitHubUri(uri: string): { owner: string; repo: string; branch?: string; path?: string } {
  // Formats: github.com/owner/repo, owner/repo, full URL with branch/path
  let cleaned = uri.replace(/^https?:\/\//, '').replace(/^github\.com\//, '');
  // Remove .git suffix
  cleaned = cleaned.replace(/\.git$/, '');

  const parts = cleaned.split('/');
  const owner = parts[0];
  const repo = parts[1];

  let branch: string | undefined;
  let subPath: string | undefined;

  if (parts.length > 2 && parts[2] === 'tree') {
    branch = parts[3];
    subPath = parts.slice(4).join('/') || undefined;
  } else if (parts.length > 2 && parts[2] === 'blob') {
    branch = parts[3];
    subPath = parts.slice(4).join('/') || undefined;
  }

  return { owner, repo, branch, path: subPath };
}

export function cloneRepo(
  owner: string,
  repo: string,
  targetDir: string,
  token?: string,
  branch?: string
): void {
  const url = token
    ? `https://${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  const branchArg = branch ? `--branch ${branch}` : '';
  const cmd = `git clone --depth 1 ${branchArg} ${url} ${targetDir}`;

  try {
    execSync(cmd, { timeout: 60000, stdio: 'pipe' });
  } catch (err: any) {
    if (err.stderr?.includes('401') || err.stderr?.includes('403')) {
      throw new Error(`GitHub authentication failed for ${owner}/${repo}. Check your GITHUB_TOKEN.`);
    }
    throw new Error(`Failed to clone ${owner}/${repo}: ${err.message}`);
  }
}

export function readRepoFiles(
  repoDir: string,
  subPath?: string
): GitHubRepoFiles[] {
  const files: GitHubRepoFiles[] = [];
  const baseDir = subPath ? path.join(repoDir, subPath) : repoDir;

  if (!fs.existsSync(baseDir)) return files;

  const TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
    '.c', '.cpp', '.h', '.hpp', '.cs',
    '.md', '.txt', '.rst', '.adoc',
    '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
    '.html', '.css', '.scss', '.less', '.svelte', '.vue',
    '.sh', '.bash', '.zsh', '.fish',
    '.sql', '.graphql', '.proto',
    '.env.example', '.gitignore', '.dockerignore',
    'Makefile', 'Dockerfile', 'Procfile',
  ]);

  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'target',
    '__pycache__', '.venv', 'venv', '.tox',
    'vendor', '.bundle',
  ]);

  function walk(dir: string, relativeTo: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(relativeTo, fullPath);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(fullPath, relativeTo);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const isText = TEXT_EXTENSIONS.has(ext) ||
          TEXT_EXTENSIONS.has(entry.name) ||
          ext === '';

        if (!isText) continue;

        // Skip large files (> 100KB)
        const stat = fs.statSync(fullPath);
        if (stat.size > 100 * 1024) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          files.push({ path: relPath, content });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(baseDir, baseDir);
  return files;
}

export function getChangedFiles(
  repoDir: string,
  since: Date
): string[] {
  try {
    const sinceStr = since.toISOString();
    const output = execSync(
      `git log --since="${sinceStr}" --name-only --pretty=format: --diff-filter=ACMR`,
      { cwd: repoDir, timeout: 10000, encoding: 'utf-8' }
    );
    return [...new Set(output.split('\n').filter(Boolean))];
  } catch {
    return []; // Treat as full re-index needed
  }
}

export function pullLatest(repoDir: string): boolean {
  try {
    const output = execSync('git pull --ff-only', {
      cwd: repoDir,
      timeout: 30000,
      encoding: 'utf-8',
    });
    return !output.includes('Already up to date');
  } catch {
    return false;
  }
}
