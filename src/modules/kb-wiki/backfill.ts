/**
 * Backfill: rebuild a workspace's wiki for a namespace by emitting
 * WikiSource events for every existing source row.
 *
 * Critical for production: a workspace with thousands of rows would
 * burn a huge amount of Anthropic spend if all enqueued at once. We
 * rate-limit per workspace (default 60/min) and persist progress in
 * `kb_wiki_backfills` so a worker restart resumes cleanly.
 */
import { v4 as uuid } from 'uuid';
import { execute, query, queryOne } from '../../db';
import { logger } from '../../utils/logger';
import { enqueueWikiIngest, getNamespaceMode, setNamespaceMode } from './sources';
import type { WikiNamespace, WikiSource } from '../../types';

const TICK_INTERVAL_MS = 1_000;            // re-evaluate budget once a second

export interface BackfillJob {
  id: string;
  workspace_id: string;
  namespace: WikiNamespace;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled';
  total: number;
  enqueued: number;
  completed: number;
  failed: number;
  rate_per_minute: number;
  cursor: string | null;
  error: string | null;
}

export async function startBackfill(
  workspaceId: string, namespace: WikiNamespace, userId: string,
  ratePerMinute: number,
): Promise<BackfillJob> {
  const existing = await queryOne<any>(
    `SELECT id FROM kb_wiki_backfills
       WHERE workspace_id = $1 AND namespace = $2
         AND status IN ('pending', 'running', 'paused')`,
    [workspaceId, namespace],
  );
  if (existing) throw new Error('A backfill is already active for this namespace');

  const total = await countSources(workspaceId, namespace);
  const id = uuid();
  await execute(
    `INSERT INTO kb_wiki_backfills (id, workspace_id, namespace, status, total, rate_per_minute, created_by)
       VALUES ($1, $2, $3, 'running', $4, $5, $6)`,
    [id, workspaceId, namespace, total, ratePerMinute, userId],
  );
  // Flip mode to wiki so the underlying enqueue actually fires.
  if ((await getNamespaceMode(workspaceId, namespace)) === 'search') {
    await setNamespaceMode(workspaceId, namespace, 'both');
  }
  // Kick off the runner — fire-and-forget. The runner persists progress so
  // a process restart resumes from the same cursor.
  void runBackfill(id).catch(err => logger.error('Backfill runner crashed', { id, error: err.message }));
  const fresh = await loadBackfill(id);
  if (!fresh) throw new Error('Backfill row vanished');
  return fresh;
}

export async function controlBackfill(workspaceId: string, id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void> {
  const job = await queryOne<any>(
    `SELECT * FROM kb_wiki_backfills WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
  if (!job) throw new Error('Backfill not found');
  if (action === 'pause') {
    await execute(`UPDATE kb_wiki_backfills SET status = 'paused', updated_at = NOW() WHERE id = $1 AND status = 'running'`, [id]);
  } else if (action === 'resume') {
    await execute(`UPDATE kb_wiki_backfills SET status = 'running', updated_at = NOW() WHERE id = $1 AND status = 'paused'`, [id]);
    void runBackfill(id).catch(err => logger.error('Backfill resume crashed', { id, error: err.message }));
  } else if (action === 'cancel') {
    await execute(`UPDATE kb_wiki_backfills SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);
  } else {
    throw new Error(`Unknown action ${action}`);
  }
}

async function runBackfill(id: string): Promise<void> {
  let job = await loadBackfill(id);
  if (!job) return;

  while (job && job.status === 'running' && job.enqueued < job.total) {
    const budget = job.rate_per_minute;
    const startedTick = Date.now();
    let enqueuedThisMinute = 0;

    while (enqueuedThisMinute < budget && job.enqueued < job.total) {
      const fresh = await loadBackfill(id);
      if (!fresh || fresh.status !== 'running') return;
      job = fresh;

      const next = await fetchNextSource(job.workspace_id, job.namespace, job.cursor);
      if (!next) {
        await execute(
          `UPDATE kb_wiki_backfills SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [id],
        );
        return;
      }

      try {
        await enqueueWikiIngest(job.workspace_id, next);
        await execute(
          `UPDATE kb_wiki_backfills
              SET enqueued = enqueued + 1, cursor = $1, updated_at = NOW()
            WHERE id = $2`,
          [next.source_id, id],
        );
        enqueuedThisMinute++;
      } catch (err: any) {
        logger.warn('Backfill enqueue failed', { id, source: next, error: err.message });
        await execute(
          `UPDATE kb_wiki_backfills
              SET failed = failed + 1, cursor = $1, updated_at = NOW(), error = $2
            WHERE id = $3`,
          [next.source_id, err.message.slice(0, 500), id],
        );
      }

      // Spread enqueues across the minute to avoid bursts.
      const interval = Math.max(60_000 / Math.max(budget, 1), TICK_INTERVAL_MS);
      await new Promise(r => setTimeout(r, interval));
    }

    // Wait out the remainder of the minute before the next tranche.
    const elapsed = Date.now() - startedTick;
    if (elapsed < 60_000) await new Promise(r => setTimeout(r, 60_000 - elapsed));
  }

  // Final state
  const last = await loadBackfill(id);
  if (last && last.enqueued >= last.total && last.status === 'running') {
    await execute(`UPDATE kb_wiki_backfills SET status = 'completed', updated_at = NOW() WHERE id = $1`, [id]);
  }
}

async function loadBackfill(id: string): Promise<BackfillJob | null> {
  const row = await queryOne<any>(`SELECT * FROM kb_wiki_backfills WHERE id = $1`, [id]);
  return row || null;
}

async function countSources(workspaceId: string, namespace: WikiNamespace): Promise<number> {
  if (namespace === 'kb') {
    const [row] = await query<any>(
      `SELECT count(*)::int AS c FROM kb_entries WHERE workspace_id = $1 AND approved = true`,
      [workspaceId],
    );
    return row?.c ?? 0;
  }
  const [row] = await query<any>(
    `SELECT count(*)::int AS c FROM documents WHERE workspace_id = $1 AND is_archived = false`,
    [workspaceId],
  );
  return row?.c ?? 0;
}

async function fetchNextSource(
  workspaceId: string, namespace: WikiNamespace, cursor: string | null,
): Promise<WikiSource | null> {
  if (namespace === 'kb') {
    const row = await queryOne<any>(
      `SELECT id, source_external_id, updated_at FROM kb_entries
        WHERE workspace_id = $1 AND approved = true
          AND ($2::text IS NULL OR id > $2)
        ORDER BY id LIMIT 1`,
      [workspaceId, cursor],
    );
    if (!row) return null;
    if (row.source_external_id) {
      return { namespace: 'kb', source_kind: 'drive_file', source_id: row.source_external_id, revision: String(row.updated_at) };
    }
    return { namespace: 'kb', source_kind: 'kb_entry', source_id: row.id, revision: String(row.updated_at) };
  }
  const row = await queryOne<any>(
    `SELECT id, updated_at FROM documents
      WHERE workspace_id = $1 AND is_archived = false
        AND ($2::text IS NULL OR id > $2)
      ORDER BY id LIMIT 1`,
    [workspaceId, cursor],
  );
  if (!row) return null;
  return { namespace: 'docs', source_kind: 'document', source_id: row.id, revision: String(row.updated_at) };
}
