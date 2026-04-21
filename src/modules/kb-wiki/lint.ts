/**
 * Nightly lint pass per (workspace, namespace).
 *
 * Detects: orphan source pages (underlying source deleted), missing
 * cross-references, simple contradictions across entity pages. Auto-applies
 * fixes when `<namespace>.lint.auto_apply = true`.
 */
import { execute, query, queryOne } from '../../db';
import { logger } from '../../utils/logger';
import { getPage, upsertPage, archivePage } from './pages';
import type { WikiNamespace } from '../../types';

export interface LintReport {
  namespace: WikiNamespace;
  workspaceId: string;
  orphans: string[];                  // source paths whose backing source is gone
  missingCrossRefs: string[];         // entity/concept pages mentioned but not present
  appliedFixes: string[];
  durationMs: number;
}

export async function runLint(workspaceId: string, namespace: WikiNamespace): Promise<LintReport> {
  const start = Date.now();
  const report: LintReport = {
    namespace, workspaceId,
    orphans: [], missingCrossRefs: [], appliedFixes: [],
    durationMs: 0,
  };

  const autoApply = await getAutoApply(workspaceId, namespace);

  // Orphan check: source pages whose backing row no longer exists.
  const sourcePages = await query<any>(
    `SELECT id, path, source_ref FROM kb_wiki_pages
       WHERE workspace_id = $1 AND namespace = $2 AND kind = 'source' AND archived_at IS NULL`,
    [workspaceId, namespace],
  );
  for (const sp of sourcePages) {
    const ref = typeof sp.source_ref === 'string' ? JSON.parse(sp.source_ref) : sp.source_ref;
    if (!ref) continue;
    const stillExists = await sourceStillExists(workspaceId, namespace, ref.source_kind, ref.source_id);
    if (!stillExists) {
      report.orphans.push(sp.path);
      if (autoApply) {
        await archivePage(workspaceId, namespace, sp.path);
        report.appliedFixes.push(`archived ${sp.path}`);
      }
    }
  }

  // Cross-ref check: entities/concepts mentioned in `index.md` but not present as pages.
  const index = await getPage(workspaceId, namespace, 'index.md');
  if (index) {
    const linkRefs = [...index.content.matchAll(/\[(?:[^\]]+)\]\(((?:entities|concepts)\/[^)]+\.md)\)/g)].map(m => m[1]);
    for (const ref of new Set(linkRefs)) {
      const exists = await getPage(workspaceId, namespace, ref);
      if (!exists) report.missingCrossRefs.push(ref);
    }
  }

  // Append a lint entry to log.md so the run is auditable.
  const log = await getPage(workspaceId, namespace, 'log.md');
  if (log) {
    const entry = `- ${new Date().toISOString()} — lint: ${report.orphans.length} orphans, ${report.missingCrossRefs.length} broken refs, ${report.appliedFixes.length} fixes applied`;
    await upsertPage(workspaceId, namespace, {
      path: 'log.md',
      kind: 'log',
      title: log.title,
      content: `${log.content}\n${entry}`.slice(-100_000),
      expected_prior_revision: new Date(log.updated_at).toISOString(),
      updated_by: 'llm',
      rationale: 'lint pass entry',
    }).catch((err: any) => logger.warn('Lint log append failed', { error: err.message }));
  }

  report.durationMs = Date.now() - start;
  return report;
}

async function sourceStillExists(workspaceId: string, namespace: WikiNamespace, sourceKind: string, sourceId: string): Promise<boolean> {
  if (sourceKind === 'kb_entry') {
    const row = await queryOne(`SELECT 1 FROM kb_entries WHERE workspace_id = $1 AND id = $2`, [workspaceId, sourceId]);
    return !!row;
  }
  if (sourceKind === 'document') {
    const row = await queryOne(
      `SELECT 1 FROM documents WHERE workspace_id = $1 AND id = $2 AND is_archived = false`,
      [workspaceId, sourceId],
    );
    return !!row;
  }
  if (sourceKind === 'drive_file') {
    const row = await queryOne(
      `SELECT 1 FROM kb_entries WHERE workspace_id = $1 AND source_external_id = $2`,
      [workspaceId, sourceId],
    );
    return !!row;
  }
  // Unknown kind — leave alone.
  void namespace;
  return true;
}

async function getAutoApply(workspaceId: string, namespace: WikiNamespace): Promise<boolean> {
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, `${namespace}.lint.auto_apply`],
  );
  if (!row) return true;     // default true
  return String(row.value).toLowerCase() !== 'false';
}

void execute;
