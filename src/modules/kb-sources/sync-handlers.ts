/**
 * KB Source Sync Handlers — fetch content from external sources and create KB entries.
 *
 * Each handler:
 *   1. Gets API credentials from kb_api_keys
 *   2. Fetches content via the provider's API
 *   3. Creates KB entries via createKBEntry()
 *   4. Updates source status / entry_count
 */
import https from 'https';
import { createKBEntry, upsertKBEntryByExternalId, deleteStaleKBEntries } from '../knowledge-base';
import { getApiKey, updateSource, updateSourceStatus } from './index';
import { getProviderForConnector, normalizeConnectorType } from './connectors';
import { parseDocument } from './parsers';
import { recordSkippedFile, clearSkippedFile, type SkipReason } from './skip-log';
import { logger } from '../../utils/logger';
import type { KBSource, KBConnectorType } from '../../types';

// Hard cap on downloaded file size. Files above this are never buffered —
// we surface a `too_large` skip log entry and move on. Default is generous
// (250 MB); self-hosters can override via env var for even larger files.
// Note: individual parsers may impose tighter practical limits internally
// and downgrade to a warning rather than abort the sync.
export const KB_MAX_FILE_BYTES: number = (() => {
  const override = process.env.KB_MAX_FILE_BYTES;
  if (override) {
    const n = Number(override);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 250 * 1024 * 1024;
})();

// Per-sync warning accumulator. The Drive handler (and future handlers) push
// user-facing, per-file warnings here; syncSource persists them onto the
// kb_sources row under last_sync_warnings so the dashboard can surface which
// files were skipped and why without aborting the whole sync.
interface SyncRunContext {
  warnings: string[];
}

// ── HTTP Helpers ──

interface ApiResponse {
  status: number;
  data: any;
}

function httpsRequest(
  hostname: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: any,
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const hdrs: Record<string, string> = { 'Accept': 'application/json', ...headers };
    if (payload) {
      hdrs['Content-Type'] = 'application/json';
      hdrs['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const options: https.RequestOptions = { hostname, path, method, headers: hdrs };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode || 0, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function httpsGet(
  hostname: string,
  path: string,
  headers: Record<string, string>,
): Promise<ApiResponse> {
  return httpsRequest(hostname, path, 'GET', headers);
}

/** Fetch raw text content (not JSON) */
function httpsGetRaw(
  hostname: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      // Follow redirects (GitHub raw URLs may redirect)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const url = new URL(res.headers.location);
        httpsGetRaw(url.hostname, url.pathname + url.search, headers).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

// ── Shared Helpers ──

async function getProviderCredentials(workspaceId: string, sourceType: KBConnectorType): Promise<Record<string, string>> {
  const provider = getProviderForConnector(sourceType);
  const apiKey = await getApiKey(workspaceId, provider);
  if (!apiKey || !apiKey.setup_complete) {
    throw new Error(`Provider "${provider}" is not configured. Set up API keys first.`);
  }
  return JSON.parse(apiKey.config_json);
}

/** Strip JSX/MDX components from markdown, preserving text content */
function stripJsx(mdx: string): string {
  // Remove import statements
  let text = mdx.replace(/^import\s+.*$/gm, '');
  // Remove JSX self-closing tags: <Component prop="val" />
  text = text.replace(/<[A-Z][A-Za-z]*\s[^>]*\/>/g, '');
  // Remove JSX opening and closing tags but keep children content
  text = text.replace(/<\/?[A-Z][A-Za-z]*[^>]*>/g, '');
  // Remove export statements
  text = text.replace(/^export\s+(default\s+)?/gm, '');
  // Clean up excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/** Parse YAML-ish frontmatter from MDX files */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body: match[2] };
}

// ── Dispatch ──

export async function syncSource(workspaceId: string, source: KBSource): Promise<number> {
  const config = JSON.parse(source.config_json);
  const resolvedType = normalizeConnectorType(source.source_type);
  const handler = SYNC_HANDLERS[resolvedType];
  if (!handler) throw new Error(`No sync handler for source type: ${source.source_type}`);

  const ctx: SyncRunContext = { warnings: [] };

  try {
    await updateSourceStatus(workspaceId, source.id, 'syncing');
    const count = await handler(workspaceId, source, config, ctx);
    const warnings = formatWarnings(ctx.warnings);
    await updateSource(workspaceId, source.id, {
      status: 'active',
      entry_count: count,
      last_sync_at: new Date().toISOString(),
      error_message: null,
      last_sync_warnings: warnings,
    });
    logger.info('KB source sync completed', { sourceId: source.id, type: source.source_type, entries: count, warnings: ctx.warnings.length });
    return count;
  } catch (err: any) {
    await updateSource(workspaceId, source.id, {
      status: 'error',
      error_message: err.message?.slice(0, 500) || 'Unknown error',
      last_sync_warnings: formatWarnings(ctx.warnings),
    });
    logger.error('KB source sync failed', { sourceId: source.id, error: err.message });
    throw err;
  }
}

function formatWarnings(warnings: string[]): string | null {
  if (!warnings.length) return null;
  // Cap at 8KB and a few hundred lines so a pathological sync doesn't fill
  // the row. Keep the first warnings (usually most informative) and note the
  // overflow.
  const MAX = 8000;
  const joined = warnings.join('\n');
  if (joined.length <= MAX) return joined;
  return joined.slice(0, MAX) + `\n… (+${warnings.length - joined.slice(0, MAX).split('\n').length} more warnings)`;
}

type SyncHandler = (workspaceId: string, source: KBSource, config: Record<string, string>, ctx: SyncRunContext) => Promise<number>;

const SYNC_HANDLERS: Record<KBConnectorType, SyncHandler> = {
  github: syncGitHub,
  zendesk_help_center: syncZendeskHelpCenter,
  website: syncWebsite,
  google_drive: syncGoogleDrive,
  hubspot_kb: syncHubSpotKB,
  linear_docs: syncLinearDocs,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GitHub Sync (with Mintlify support)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface GitHubFile {
  path: string;
  type: 'file' | 'dir';
  download_url: string | null;
  size: number;
}

async function githubApi(path: string, token: string): Promise<ApiResponse> {
  return httpsGet('api.github.com', path, {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'TinyHands-KB-Sync',
    'X-GitHub-Api-Version': '2022-11-28',
  });
}

async function githubRaw(url: string, token: string): Promise<string> {
  const parsed = new URL(url);
  const res = await httpsGetRaw(parsed.hostname, parsed.pathname + parsed.search, {
    'Authorization': `Bearer ${token}`,
    'User-Agent': 'TinyHands-KB-Sync',
  });
  if (res.status >= 400) throw new Error(`GitHub raw fetch failed (${res.status}): ${url}`);
  return res.data;
}

/** Recursively list files in a GitHub directory */
async function listGitHubDir(repo: string, dirPath: string, branch: string, token: string): Promise<GitHubFile[]> {
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const apiPath = `/repos/${repo}/contents/${dirPath}${ref}`;
  const res = await githubApi(apiPath, token);
  if (res.status >= 400) {
    logger.warn('GitHub API error listing directory', { repo, dirPath, status: res.status, response: JSON.stringify(res.data).slice(0, 300) });
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GitHub API auth failed (${res.status}) for ${repo} — check that the token is valid and has repo access`);
    }
    if (res.status === 404) {
      throw new Error(`GitHub path not found: ${repo}/${dirPath} (branch: ${branch}) — check repo name and paths`);
    }
    throw new Error(`GitHub API error (${res.status}) listing ${repo}/${dirPath}`);
  }
  if (!Array.isArray(res.data)) {
    logger.warn('GitHub API returned non-array for directory listing', { repo, dirPath, dataType: typeof res.data });
    return [];
  }

  const files: GitHubFile[] = [];
  for (const item of res.data) {
    if (item.type === 'file') {
      files.push(item);
    } else if (item.type === 'dir') {
      try {
        const subFiles = await listGitHubDir(repo, item.path, branch, token);
        files.push(...subFiles);
      } catch (err: any) {
        logger.warn('Failed to list GitHub subdirectory', { repo, subDir: item.path, error: err.message });
      }
    }
  }
  return files;
}

/** Detect and parse Mintlify config (docs.json or mint.json) */
async function detectMintlify(
  repo: string,
  basePath: string,
  branch: string,
  token: string,
): Promise<{ isMintlify: boolean; config?: any; configPath?: string }> {
  const base = basePath ? basePath.replace(/\/$/, '') + '/' : '';
  for (const configName of ['docs.json', 'mint.json']) {
    const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
    const res = await githubApi(`/repos/${repo}/contents/${base}${configName}${ref}`, token);
    if (res.status < 400 && res.data?.download_url) {
      try {
        const raw = await githubRaw(res.data.download_url, token);
        const config = JSON.parse(raw);
        logger.info('Mintlify config loaded', { repo, configPath: `${base}${configName}`, topKeys: Object.keys(config).join(', ') });
        return { isMintlify: true, config, configPath: `${base}${configName}` };
      } catch (err: any) {
        logger.warn('Mintlify config found but failed to parse', { repo, configName, error: err.message });
      }
    }
  }
  return { isMintlify: false };
}

/** Extract page paths from Mintlify navigation structure */
function extractMintlifyPages(nav: any): string[] {
  const pages: string[] = [];

  function walk(items: any[]): void {
    for (const item of items) {
      if (typeof item === 'string') {
        pages.push(item);
      } else if (item && typeof item === 'object') {
        // Group: { group: "Name", pages: [...] }
        if (Array.isArray(item.pages)) walk(item.pages);
        // Tab navigation: { tab: "Name", pages: [...] } or { tab: "Name", groups: [...] }
        if (Array.isArray(item.groups)) walk(item.groups);
        // Anchors or other nested items with children
        if (Array.isArray(item.items)) walk(item.items);
      }
    }
  }

  // navigation can be array of groups, or object with tabs
  if (Array.isArray(nav)) {
    walk(nav);
  } else if (nav && typeof nav === 'object') {
    // Tabs-style: { tabs: [{ tab: "...", groups: [...] }] }
    if (Array.isArray(nav.tabs)) {
      for (const tab of nav.tabs) {
        if (Array.isArray(tab.pages)) walk(tab.pages);
        if (Array.isArray(tab.groups)) walk(tab.groups);
        if (Array.isArray(tab.items)) walk(tab.items);
      }
    }
  }
  return pages;
}

/** Extract navigation from Mintlify config (handles multiple config formats) */
function getMintlifyNavigation(config: any): any {
  // Standard: config.navigation (array of groups)
  if (config.navigation) return config.navigation;

  // Newer format: top-level tabs array containing groups/pages
  if (Array.isArray(config.tabs)) return { tabs: config.tabs };

  // Some configs use sidebar directly
  if (config.sidebar) return config.sidebar;

  // Try anchors as navigation source
  if (config.anchors) return config.anchors;

  return null;
}

/** Extract category from Mintlify navigation for a given page path */
function getMintlifyCategory(nav: any, pagePath: string): string {
  function findGroup(items: any[], parentGroup?: string): string | null {
    for (const item of items) {
      if (typeof item === 'string' && item === pagePath) {
        return parentGroup || 'docs';
      }
      if (item && typeof item === 'object') {
        if (Array.isArray(item.pages)) {
          const found = findGroup(item.pages, item.group || item.tab || parentGroup);
          if (found) return found;
        }
        if (Array.isArray(item.groups)) {
          const found = findGroup(item.groups, item.group || item.tab || parentGroup);
          if (found) return found;
        }
      }
    }
    return null;
  }

  if (Array.isArray(nav)) {
    return findGroup(nav) || 'docs';
  }
  if (nav?.tabs) {
    for (const tab of nav.tabs) {
      const pages = tab.pages || tab.groups || [];
      const found = findGroup(pages, tab.tab);
      if (found) return found;
    }
  }
  return 'docs';
}

async function syncGitHub(workspaceId: string, source: KBSource, config: Record<string, string>, _ctx: SyncRunContext): Promise<number> {
  const creds = await getProviderCredentials(workspaceId, 'github');
  const token = creds.token;
  const repo = config.repo; // e.g. "owner/repo"
  const branch = config.branch || 'main';
  const paths = config.paths ? config.paths.split(',').map(p => p.trim()) : [''];
  const contentType = config.content_type || 'docs'; // docs | mintlify | source_code

  if (!repo) throw new Error('Repository (repo) is required');
  if (!token) throw new Error('GitHub token is not configured. Set up GitHub API keys first.');

  // Validate token + repo access before proceeding
  const repoCheck = await githubApi(`/repos/${repo}`, token);
  if (repoCheck.status === 401 || repoCheck.status === 403) {
    throw new Error(`GitHub token is invalid or lacks access to ${repo} (${repoCheck.status})`);
  }
  if (repoCheck.status === 404) {
    throw new Error(`GitHub repository "${repo}" not found — check the repo name (format: owner/repo)`);
  }
  if (repoCheck.status >= 400) {
    throw new Error(`GitHub API error (${repoCheck.status}) checking repo ${repo}: ${JSON.stringify(repoCheck.data).slice(0, 200)}`);
  }

  let count = 0;

  // Check for Mintlify if content_type is 'mintlify' or 'docs'
  if (contentType === 'mintlify' || contentType === 'docs') {
    const basePath = paths[0] || '';
    const mintlify = await detectMintlify(repo, basePath, branch, token);

    if (mintlify.isMintlify && mintlify.config) {
      logger.info('Mintlify docs detected', { repo, configPath: mintlify.configPath, configKeys: Object.keys(mintlify.config).join(', ') });
      const nav = getMintlifyNavigation(mintlify.config);
      if (!nav) {
        logger.warn('Mintlify config found but no navigation structure detected', { repo, configKeys: Object.keys(mintlify.config).join(', ') });
      }
      const pageRefs = nav ? extractMintlifyPages(nav) : [];
      logger.info('Mintlify pages extracted', { repo, pageCount: pageRefs.length });

      if (pageRefs.length === 0) {
        logger.info('Mintlify navigation empty, falling back to standard sync', { repo });
        // Fall through to standard GitHub sync below
      } else {
        const docsBase = basePath ? basePath.replace(/\/$/, '') + '/' : '';

        for (const pageRef of pageRefs) {
          try {
            // Try .mdx first, then .md
            let content: string | null = null;
            let filePath = '';
            for (const ext of ['.mdx', '.md', '']) {
              const tryPath = `${docsBase}${pageRef}${ext}`;
              const ref = `?ref=${encodeURIComponent(branch)}`;
              const res = await githubApi(`/repos/${repo}/contents/${tryPath}${ref}`, token);
              if (res.status < 400 && res.data?.download_url) {
                content = await githubRaw(res.data.download_url, token);
                filePath = tryPath;
                break;
              }
            }

            if (!content) {
              logger.debug('Mintlify page not found, skipping', { repo, pageRef });
              continue;
            }

            const { frontmatter, body } = parseFrontmatter(content);
            const cleanBody = stripJsx(body);
            const title = frontmatter.title || frontmatter.sidebarTitle || pageRef.split('/').pop() || pageRef;
            const description = frontmatter.description || '';
            const category = getMintlifyCategory(nav, pageRef);

            await createKBEntry(workspaceId, {
              title,
              summary: description || cleanBody.slice(0, 200),
              content: cleanBody,
              category,
              tags: [repo, 'mintlify', ...(frontmatter.tags ? frontmatter.tags.split(',').map((t: string) => t.trim()) : [])],
              accessScope: 'all',
              sourceType: 'github',
              approved: true,
              kbSourceId: source.id,
            });
            count++;
          } catch (err: any) {
            logger.warn('Failed to sync Mintlify page', { repo, pageRef, error: err.message });
          }
        }

        return count;
      }
    }
  }

  // Standard GitHub docs/source sync
  for (const dirPath of paths) {
    const files = await listGitHubDir(repo, dirPath.replace(/\/$/, ''), branch, token);
    const docExtensions = ['.md', '.mdx', '.txt', '.rst'];
    const codeExtensions = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.rb', '.sh'];
    const allowedExts = contentType === 'source_code' ? codeExtensions : docExtensions;

    logger.info('GitHub directory listing result', { repo, dirPath, totalFiles: files.length, allowedExts: allowedExts.join(', ') });

    let skippedExt = 0;
    let skippedSize = 0;
    let skippedNoUrl = 0;
    let failed = 0;

    for (const file of files) {
      const ext = '.' + file.path.split('.').pop()?.toLowerCase();
      if (!allowedExts.includes(ext)) { skippedExt++; continue; }
      if (file.size > 500000) { skippedSize++; continue; }

      try {
        if (!file.download_url) { skippedNoUrl++; continue; }
        const content = await githubRaw(file.download_url, token);
        const { frontmatter, body } = parseFrontmatter(content);
        const cleanBody = ext === '.mdx' ? stripJsx(body) : body;
        const title = frontmatter.title || file.path.split('/').pop()?.replace(/\.\w+$/, '') || file.path;

        await createKBEntry(workspaceId, {
          title,
          summary: frontmatter.description || cleanBody.slice(0, 200),
          content: cleanBody,
          category: contentType === 'source_code' ? 'source_code' : 'docs',
          tags: [repo, file.path],
          accessScope: 'all',
          sourceType: 'github',
          approved: true,
          kbSourceId: source.id,
        });
        count++;
      } catch (err: any) {
        failed++;
        logger.warn('Failed to sync GitHub file', { repo, path: file.path, error: err.message });
      }
    }

    if (count === 0 && files.length > 0) {
      logger.warn('GitHub sync found files but created 0 entries', {
        repo, dirPath, totalFiles: files.length,
        skippedExt, skippedSize, skippedNoUrl, failed,
        sampleFiles: files.slice(0, 5).map(f => f.path),
      });
    }
  }

  if (count === 0) {
    logger.warn('GitHub sync completed with 0 entries', { repo, branch, paths: paths.join(', '), contentType });
  }

  return count;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Zendesk Help Center Sync
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function syncZendeskHelpCenter(workspaceId: string, source: KBSource, config: Record<string, string>, _ctx: SyncRunContext): Promise<number> {
  const creds = await getProviderCredentials(workspaceId, 'zendesk_help_center');
  const subdomain = creds.subdomain;
  const email = creds.email;
  const apiToken = creds.api_token;
  const locale = config.locale || 'en-us';
  const categoryId = config.category_id;

  const authHeader = 'Basic ' + Buffer.from(`${email}/token:${apiToken}`).toString('base64');
  let count = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let path = `/api/v2/help_center/${locale}/articles.json?page=${page}&per_page=100`;
    if (categoryId) {
      path = `/api/v2/help_center/${locale}/categories/${categoryId}/articles.json?page=${page}&per_page=100`;
    }

    const res = await httpsGet(`${subdomain}.zendesk.com`, path, { 'Authorization': authHeader });
    if (res.status >= 400) throw new Error(`Zendesk API error (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);

    const articles = res.data.articles || [];
    for (const article of articles) {
      if (article.draft) continue;

      // Strip HTML tags for plain text
      const plainContent = (article.body || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

      await createKBEntry(workspaceId, {
        title: article.title,
        summary: plainContent.slice(0, 200),
        content: plainContent,
        category: article.section_id ? `section-${article.section_id}` : 'help-center',
        tags: (article.label_names || []).concat(['zendesk']),
        accessScope: 'all',
        sourceType: 'zendesk_help_center',
        approved: true,
        kbSourceId: source.id,
      });
      count++;
    }

    hasMore = res.data.next_page != null;
    page++;
  }

  return count;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Website Sync (Firecrawl)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function syncWebsite(workspaceId: string, source: KBSource, config: Record<string, string>, _ctx: SyncRunContext): Promise<number> {
  const creds = await getProviderCredentials(workspaceId, 'website');
  const apiKey = creds.api_key;
  const url = config.url;
  const maxPages = parseInt(config.max_pages || '50', 10);
  const includePaths = config.include_paths ? config.include_paths.split(',').map(p => p.trim()) : undefined;
  const excludePaths = config.exclude_paths ? config.exclude_paths.split(',').map(p => p.trim()) : undefined;

  if (!url) throw new Error('Website URL is required');

  // Start a crawl job
  const crawlBody: any = {
    url,
    limit: maxPages,
    scrapeOptions: { formats: ['markdown'] },
  };
  if (includePaths) crawlBody.includePaths = includePaths;
  if (excludePaths) crawlBody.excludePaths = excludePaths;

  const crawlRes = await httpsRequest('api.firecrawl.dev', '/v1/crawl', 'POST', {
    'Authorization': `Bearer ${apiKey}`,
  }, crawlBody);

  if (crawlRes.status >= 400) {
    throw new Error(`Firecrawl crawl failed (${crawlRes.status}): ${JSON.stringify(crawlRes.data).slice(0, 300)}`);
  }

  const crawlId = crawlRes.data.id;
  if (!crawlId) throw new Error('Firecrawl did not return a crawl ID');

  // Poll for completion
  let count = 0;
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes with 5s intervals

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 5000));
    attempts++;

    const statusRes = await httpsGet('api.firecrawl.dev', `/v1/crawl/${crawlId}`, {
      'Authorization': `Bearer ${apiKey}`,
    });

    if (statusRes.status >= 400) {
      throw new Error(`Firecrawl status check failed (${statusRes.status})`);
    }

    const { status, data: pages } = statusRes.data;

    if (status === 'completed' || (Array.isArray(pages) && pages.length > 0)) {
      for (const page of (pages || [])) {
        const markdown = page.markdown || page.content || '';
        const title = page.metadata?.title || page.metadata?.ogTitle || new URL(page.url || url).pathname;

        if (!markdown.trim()) continue;

        await createKBEntry(workspaceId, {
          title,
          summary: (page.metadata?.description || markdown.slice(0, 200)).slice(0, 500),
          content: markdown,
          category: 'website',
          tags: ['website', new URL(page.url || url).hostname],
          accessScope: 'all',
          sourceType: 'website',
          approved: true,
          kbSourceId: source.id,
        });
        count++;
      }

      if (status === 'completed') break;
    }

    if (status === 'failed') {
      throw new Error('Firecrawl crawl failed');
    }
  }

  if (attempts >= maxAttempts) {
    throw new Error('Firecrawl crawl timed out after 10 minutes');
  }

  return count;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Google Drive Sync
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── Drive MIME handling ──
//
// Google-native formats (Docs/Sheets/Slides) export through the Drive
// /files/:id/export endpoint to a text-like MIME. Everything else is
// downloaded raw via /files/:id?alt=media and handed to the parser layer.
// Legacy binary formats (.doc / .xls / .ppt) go through the same parsers
// best-effort; unsupported files produce a per-file warning on the sync
// run rather than aborting the whole crawl.

interface GoogleExport {
  exportMime: string;
  label: string;
}

const GOOGLE_NATIVE_EXPORTS: Record<string, GoogleExport> = {
  'application/vnd.google-apps.document': { exportMime: 'text/markdown', label: 'Google Doc' },
  'application/vnd.google-apps.spreadsheet': { exportMime: 'text/csv', label: 'Google Sheet' },
  'application/vnd.google-apps.presentation': { exportMime: 'text/plain', label: 'Google Slides' },
};

// MIME types we download as bytes and pass through the parser layer.
// Anything outside this set (and not a Google-native export) is skipped
// with a warning so admins can see which files were not indexed.
const BINARY_PARSER_MIMES = new Set<string>([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/pdf',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'text/rtf',
  'text/html',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

// File extensions that are safe to treat as plain text even if Drive reports
// application/octet-stream or a generic MIME — common when the file was
// uploaded without a MIME hint.
const TEXT_EXTENSIONS = new Set<string>(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json']);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isGoogleNative(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(GOOGLE_NATIVE_EXPORTS, mime);
}

function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/open?id=${fileId}`;
}

function httpsGetBinary(
  hostname: string,
  path: string,
  headers: Record<string, string>,
  maxBytes: number = KB_MAX_FILE_BYTES,
): Promise<{ status: number; data: Buffer; oversized?: boolean; bytesRead?: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'GET', headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const url = new URL(res.headers.location, `https://${hostname}${path}`);
        httpsGetBinary(url.hostname, url.pathname + url.search, headers, maxBytes).then(resolve).catch(reject);
        return;
      }

      // Fast path — if the server tells us the content length up front and
      // it exceeds the cap, tear the connection down before reading bytes.
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.resume();
        req.destroy();
        resolve({ status: res.statusCode || 0, data: Buffer.alloc(0), oversized: true, bytesRead: declared });
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;
      res.on('data', (chunk: Buffer | string) => {
        if (aborted) return;
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        total += buf.length;
        if (total > maxBytes) {
          aborted = true;
          req.destroy();
          resolve({ status: res.statusCode || 0, data: Buffer.alloc(0), oversized: true, bytesRead: total });
          return;
        }
        chunks.push(buf);
      });
      res.on('end', () => {
        if (aborted) return;
        resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks), bytesRead: total });
      });
      res.on('error', (err) => { if (!aborted) reject(err); });
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

async function syncGoogleDrive(workspaceId: string, source: KBSource, config: Record<string, string>, ctx: SyncRunContext): Promise<number> {
  // Resolve credentials via the workspace's Google OAuth connection (personal).
  // The admin who created the KB source is preferred; any active admin's Google
  // connection is a fallback so the source keeps working if the original admin
  // disconnects or is removed from the workspace.
  const { getAnyPersonalConnection, decryptCredentials } = await import('../connections');
  const { refreshGoogleAccessToken } = await import('../connections/oauth');

  const conn = await getAnyPersonalConnection(workspaceId, 'google-drive', source.created_by);
  if (!conn) {
    throw new Error('Google Drive is not connected. Open Tools → Personal Connections and connect Google Drive, then sync again.');
  }
  let creds: Record<string, string>;
  try {
    creds = decryptCredentials(conn);
  } catch {
    // AES-GCM "Unsupported state or unable to authenticate data" — the
    // stored ciphertext can't be decrypted with the current ENCRYPTION_KEY.
    // Typically means the key was rotated or the DB came from a different
    // install. The admin needs to reconnect Google Drive to re-encrypt.
    throw new Error('Google Drive connection is broken (stored credentials cannot be decrypted). Open Tools → Personal Connections and reconnect Google Drive.');
  }
  if (!creds.refresh_token) {
    throw new Error('Google Drive connection is missing a refresh token. Open Tools → Personal Connections and reconnect Google Drive.');
  }
  const accessToken = await refreshGoogleAccessToken(workspaceId, creds.refresh_token);

  const folderId = config.folder_id || config.folderId;
  if (!folderId) throw new Error('Google Drive Folder ID is required');

  const includeSubfolders = config.include_subfolders === 'true';

  // file_types is a legacy UI filter that used short names (doc|sheet|pdf|slide).
  // When present we narrow the Drive query; when absent we crawl everything.
  const fileTypes = config.file_types ? config.file_types.split(',').map(t => t.trim()) : [];
  const legacyMimeMap: Record<string, string[]> = {
    doc: ['application/vnd.google-apps.document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
    sheet: ['application/vnd.google-apps.spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
    pdf: ['application/pdf'],
    slide: ['application/vnd.google-apps.presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'],
  };

  // Build the MIME clause once. When recursion is on and a file-type filter is
  // set, we must also allow the folder MIME through so sub-folders still show
  // up in the listing; otherwise the walk terminates at the root.
  const mimes: string[] = [];
  for (const t of fileTypes) {
    const entry = legacyMimeMap[t];
    if (entry) mimes.push(...entry);
  }
  const folderMime = 'application/vnd.google-apps.folder';
  let mimeClause = '';
  if (mimes.length > 0) {
    const allowed = includeSubfolders ? [folderMime, ...mimes] : mimes;
    mimeClause = ` and (${allowed.map(m => `mimeType = '${m}'`).join(' or ')})`;
  }

  const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
  let count = 0;
  const seenFileIds: string[] = [];

  async function crawlFolder(currentFolderId: string): Promise<string[]> {
    const driveQuery = `'${currentFolderId}' in parents and trashed = false${mimeClause}`;
    const childFolderIds: string[] = [];
    let pageToken: string | null = null;

    do {
      let path = `/drive/v3/files?q=${encodeURIComponent(driveQuery)}&fields=files(id,name,mimeType,size,modifiedTime),nextPageToken&pageSize=100`;
      if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;

      const res = await httpsGet('www.googleapis.com', path, authHeaders);
      if (res.status >= 400) throw new Error(`Google Drive API error (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);

      const files = res.data.files || [];
      for (const file of files) {
        if (file.mimeType === folderMime) {
          childFolderIds.push(file.id);
          continue;
        }
        try {
          const extracted = await extractDriveFileText({ file, authHeaders, workspaceId, source, ctx });
          if (!extracted) continue;
          const { text, mimeForEntry } = extracted;

          await upsertKBEntryByExternalId(workspaceId, {
            title: file.name,
            summary: text.slice(0, 200),
            content: text,
            category: 'google-drive',
            tags: ['google-drive', file.name, mimeForEntry].filter(Boolean) as string[],
            accessScope: 'all',
            sourceType: 'google_drive',
            approved: true,
            kbSourceId: source.id,
            sourceExternalId: file.id,
          });
          // If this file was previously in the skip log, clear it now that it
          // has ingested cleanly — the log should reflect current state.
          await clearSkippedFile(workspaceId, source.id, file.id);
          seenFileIds.push(file.id);
          count++;
        } catch (err: any) {
          logger.warn('Failed to sync Google Drive file', { name: file.name, error: err.message });
          ctx.warnings.push(`${file.name}: ${err.message}`);
          await recordSkippedFile({
            workspaceId,
            kbSourceId: source.id,
            filePath: file.id,
            filename: file.name,
            mimeType: file.mimeType || null,
            sizeBytes: file.size ? Number(file.size) : null,
            reason: 'parser_failed',
            message: err.message?.slice(0, 400) || 'Unknown sync error',
          });
        }
      }

      pageToken = res.data.nextPageToken || null;
    } while (pageToken);

    return childFolderIds;
  }

  const visitedFolderIds = new Set<string>();
  const queue: string[] = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visitedFolderIds.has(current)) continue;
    visitedFolderIds.add(current);
    const children = await crawlFolder(current);
    if (includeSubfolders) {
      for (const child of children) {
        if (!visitedFolderIds.has(child)) queue.push(child);
      }
    }
  }

  // Tombstone pass: anything in this source not seen this crawl is gone
  // (deleted, moved out of folder, or folder scope changed). Also cleans up
  // pre-upsert entries with NULL source_external_id.
  await deleteStaleKBEntries(workspaceId, source.id, seenFileIds);

  return count;
}

interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

async function extractDriveFileText(opts: {
  file: DriveFileMeta;
  authHeaders: Record<string, string>;
  workspaceId: string;
  source: KBSource;
  ctx: SyncRunContext;
}): Promise<{ text: string; mimeForEntry: string } | null> {
  const { file, authHeaders, workspaceId, source, ctx } = opts;
  const mime = file.mimeType || '';
  const declaredSize = file.size ? Number(file.size) : null;

  const recordSkip = async (reason: SkipReason, message: string, sizeBytes: number | null = declaredSize) => {
    ctx.warnings.push(`${file.name}: ${message}`);
    await recordSkippedFile({
      workspaceId,
      kbSourceId: source.id,
      filePath: file.id,
      filename: file.name,
      mimeType: mime || null,
      sizeBytes,
      reason,
      message,
    });
  };

  // 1. Google-native formats — export through Drive API to a text-like MIME.
  if (isGoogleNative(mime)) {
    const exp = GOOGLE_NATIVE_EXPORTS[mime];
    const expRes = await httpsGetRaw(
      'www.googleapis.com',
      `/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(exp.exportMime)}`,
      authHeaders,
    );
    if (expRes.status >= 400) {
      await recordSkip('download_failed', `${exp.label} export failed (HTTP ${expRes.status})`);
      return null;
    }
    if (!expRes.data.trim()) {
      await recordSkip('empty_extraction', `${exp.label} export returned no text`);
      return null;
    }
    return { text: expRes.data, mimeForEntry: exp.exportMime };
  }

  // 2. Skip video, audio, and unsupported image formats outright — these
  // aren't KB material. JPG/PNG fall through to the binary-parse path so
  // they can be OCR'd via Reducto. We still surface a warning so the admin
  // knows the file wasn't indexed.
  const isOcrCandidate = mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png';
  if (mime.startsWith('image/') && !isOcrCandidate) {
    await recordSkip('unsupported_format', `${mime} is not indexed (only jpg/png images are OCR'd)`);
    return null;
  }
  if (mime.startsWith('video/') || mime.startsWith('audio/')) {
    await recordSkip('unsupported_format', `${mime} is not indexed (audio/video)`);
    return null;
  }
  if (mime === 'application/vnd.google-apps.shortcut' || mime === 'application/vnd.google-apps.folder') {
    return null;
  }

  // 3. Binary formats we can parse — download as bytes and dispatch.
  const ext = fileExtension(file.name);
  const canParseBinary = BINARY_PARSER_MIMES.has(mime) || TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json';
  if (!canParseBinary) {
    await recordSkip('unsupported_format', `unsupported type ${mime || 'unknown'}`);
    return null;
  }

  // 4. Fast-fail on declared size before we even open the socket.
  if (declaredSize !== null && declaredSize > KB_MAX_FILE_BYTES) {
    await recordSkip(
      'too_large',
      `file is ${formatSize(declaredSize)}, larger than the ${formatSize(KB_MAX_FILE_BYTES)} per-file cap`,
      declaredSize,
    );
    return null;
  }

  const dlRes = await httpsGetBinary('www.googleapis.com', `/drive/v3/files/${file.id}?alt=media`, authHeaders);
  if (dlRes.oversized) {
    await recordSkip(
      'too_large',
      `file exceeds the ${formatSize(KB_MAX_FILE_BYTES)} per-file cap`,
      dlRes.bytesRead ?? declaredSize,
    );
    return null;
  }
  if (dlRes.status >= 400) {
    await recordSkip('download_failed', `download failed (HTTP ${dlRes.status})`);
    return null;
  }

  const parsed = await parseDocument({
    bytes: dlRes.data,
    filename: file.name,
    mimeType: mime,
    workspaceId,
  });
  if (parsed.warnings.length) ctx.warnings.push(...parsed.warnings);

  // A parser that finished but produced no text is a skip, not a silent
  // success. Record it so admins can see the file needs attention (often
  // a scanned PDF that would benefit from Reducto).
  if (!parsed.text.trim()) {
    const parserMeta = (parsed.metadata as any)?.parser;
    let reason: SkipReason;
    let message: string;
    if (parserMeta === 'image-no-reducto') {
      reason = 'reducto_required';
      message = 'image OCR requires Reducto — enable it in Settings → Integrations';
    } else if (parserMeta === 'reducto-failed') {
      reason = 'reducto_failed';
      message = parsed.warnings[0] || 'Reducto image OCR failed';
    } else if (parserMeta === 'failed') {
      reason = 'parser_failed';
      message = `could not read the file contents (${parsed.warnings[0] || 'parser error'})`;
    } else {
      reason = 'empty_extraction';
      message = 'no readable text was found — consider enabling Reducto for scanned documents';
    }
    await recordSkip(reason, message, dlRes.bytesRead ?? declaredSize);
    return null;
  }

  return { text: parsed.text, mimeForEntry: mime };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HubSpot Knowledge Base Sync
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function syncHubSpotKB(workspaceId: string, source: KBSource, config: Record<string, string>, _ctx: SyncRunContext): Promise<number> {
  const creds = await getProviderCredentials(workspaceId, 'hubspot_kb');
  const accessToken = creds.access_token;
  const state = config.state || 'PUBLISHED';

  const authHeaders = { 'Authorization': `Bearer ${accessToken}` };
  let count = 0;
  let after: string | undefined;

  do {
    let path = `/cms/v3/blogs/posts?limit=100&state=${state}`;
    if (after) path += `&after=${after}`;

    const res = await httpsGet('api.hubapi.com', path, authHeaders);
    if (res.status >= 400) throw new Error(`HubSpot API error (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);

    const results = res.data.results || [];
    for (const article of results) {
      const plainContent = (article.postBody || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

      if (!plainContent) continue;

      await createKBEntry(workspaceId, {
        title: article.name || article.htmlTitle || 'Untitled',
        summary: (article.metaDescription || plainContent.slice(0, 200)).slice(0, 500),
        content: plainContent,
        category: article.categoryId ? `category-${article.categoryId}` : 'hubspot-kb',
        tags: (article.tagIds || []).map((id: string) => `tag-${id}`).concat(['hubspot']),
        accessScope: 'all',
        sourceType: 'hubspot_kb',
        approved: true,
        kbSourceId: source.id,
      });
      count++;
    }

    after = res.data.paging?.next?.after;
  } while (after);

  return count;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Linear Docs Sync
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function linearGraphQL(query: string, variables: Record<string, any>, apiKey: string): Promise<any> {
  const res = await httpsRequest('api.linear.app', '/graphql', 'POST', {
    'Authorization': apiKey,
    'Content-Type': 'application/json',
  }, { query, variables });

  if (res.status >= 400) throw new Error(`Linear API error (${res.status}): ${JSON.stringify(res.data).slice(0, 300)}`);
  if (res.data.errors) throw new Error(`Linear GraphQL error: ${res.data.errors[0]?.message}`);
  return res.data.data;
}

async function syncLinearDocs(workspaceId: string, source: KBSource, config: Record<string, string>, _ctx: SyncRunContext): Promise<number> {
  const creds = await getProviderCredentials(workspaceId, 'linear_docs');
  const apiKey = creds.api_key;
  const teamKey = config.team_key;
  const includeIssues = config.include_issues === 'true';
  const includeProjects = config.include_projects !== 'false'; // default true

  let count = 0;

  // Sync project documents
  if (includeProjects) {
    const projectsQuery = `
      query($after: String) {
        projects(first: 50, after: $after) {
          nodes {
            id
            name
            description
            content
            state
            documents {
              nodes { id title content updatedAt }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    let afterCursor: string | null = null;
    do {
      const data = await linearGraphQL(projectsQuery, { after: afterCursor }, apiKey);
      const projects = data.projects.nodes || [];

      for (const project of projects) {
        // Add project description if substantial
        if (project.content && project.content.trim().length > 50) {
          await createKBEntry(workspaceId, {
            title: `Project: ${project.name}`,
            summary: project.description || project.content.slice(0, 200),
            content: project.content,
            category: 'linear-project',
            tags: ['linear', 'project', project.name],
            accessScope: 'all',
            sourceType: 'linear_docs',
            approved: true,
            kbSourceId: source.id,
          });
          count++;
        }

        // Add project documents
        for (const doc of (project.documents?.nodes || [])) {
          if (!doc.content || doc.content.trim().length < 20) continue;
          await createKBEntry(workspaceId, {
            title: doc.title || `${project.name} Doc`,
            summary: doc.content.slice(0, 200),
            content: doc.content,
            category: 'linear-docs',
            tags: ['linear', 'document', project.name],
            accessScope: 'all',
            sourceType: 'linear_docs',
            approved: true,
            kbSourceId: source.id,
          });
          count++;
        }
      }

      afterCursor = data.projects.pageInfo.hasNextPage ? data.projects.pageInfo.endCursor : null;
    } while (afterCursor);
  }

  // Sync issues (if requested — can be noisy)
  if (includeIssues) {
    let teamFilter = '';
    if (teamKey) {
      // Get team ID from key
      const teamData = await linearGraphQL(`query { teams(filter: { key: { eq: "${teamKey}" } }) { nodes { id } } }`, {}, apiKey);
      const teamId = teamData.teams.nodes[0]?.id;
      if (teamId) teamFilter = `, filter: { team: { id: { eq: "${teamId}" } } }`;
    }

    const issuesQuery = `
      query($after: String) {
        issues(first: 50, after: $after${teamFilter}, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            labels { nodes { name } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    let afterCursor: string | null = null;
    let issueCount = 0;
    const maxIssues = 500; // Cap to avoid importing thousands

    do {
      const data = await linearGraphQL(issuesQuery, { after: afterCursor }, apiKey);
      const issues = data.issues.nodes || [];

      for (const issue of issues) {
        if (!issue.description || issue.description.trim().length < 20) continue;
        if (issueCount >= maxIssues) break;

        await createKBEntry(workspaceId, {
          title: `${issue.identifier}: ${issue.title}`,
          summary: issue.description.slice(0, 200),
          content: issue.description,
          category: 'linear-issues',
          tags: ['linear', 'issue', issue.state?.name || 'unknown', ...(issue.labels?.nodes?.map((l: any) => l.name) || [])],
          accessScope: 'all',
          sourceType: 'linear_docs',
          approved: true,
          kbSourceId: source.id,
        });
        count++;
        issueCount++;
      }

      if (issueCount >= maxIssues) break;
      afterCursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
    } while (afterCursor);
  }

  return count;
}
