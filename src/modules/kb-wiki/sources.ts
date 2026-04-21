/**
 * WikiSource events — the unified trigger for ingest jobs.
 *
 * Every write to a KB entry, document, or Drive file flows through
 * `enqueueWikiIngest`, which:
 *   1. Inserts a kb_ingest_jobs row in `queued` state.
 *   2. Adds a job to the kb-ingest BullMQ queue with a Redis dedup key
 *      so rapid edits to the same source collapse into one trailing
 *      ingest pass (debounce).
 *
 * The actual parsing + LLM pass happens in the worker (see ingest.ts).
 */
import { v4 as uuid } from 'uuid';
import { Queue } from 'bullmq';
import { execute, queryOne } from '../../db';
import { getRedisConnection, rkey } from '../../queue';
import { logger } from '../../utils/logger';
import type { WikiSource } from '../../types';

export const WIKI_INGEST_QUEUE = 'kb-ingest';
export const WIKI_LINT_QUEUE = 'kb-lint';
export const WIKI_BACKFILL_QUEUE = 'kb-backfill';

const DEBOUNCE_TTL_SECONDS = 8;     // collapse rapid saves into one trailing ingest
const DEBOUNCE_DELAY_MS = 5_000;     // job runs ~5s after the last write

let ingestQueue: Queue | null = null;
let lintQueue: Queue | null = null;
let backfillQueue: Queue | null = null;

export function getIngestQueue(): Queue {
  if (!ingestQueue) {
    ingestQueue = new Queue(WIKI_INGEST_QUEUE, {
      connection: getRedisConnection() as any,
      defaultJobOptions: { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
    });
  }
  return ingestQueue;
}

export function getLintQueue(): Queue {
  if (!lintQueue) {
    lintQueue = new Queue(WIKI_LINT_QUEUE, {
      connection: getRedisConnection() as any,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
    });
  }
  return lintQueue;
}

export function getBackfillQueue(): Queue {
  if (!backfillQueue) {
    backfillQueue = new Queue(WIKI_BACKFILL_QUEUE, {
      connection: getRedisConnection() as any,
      defaultJobOptions: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
    });
  }
  return backfillQueue;
}

export interface IngestJobPayload {
  jobId: string;
  workspaceId: string;
  source: WikiSource;
}

/**
 * Enqueue a wiki ingest. Idempotent — repeated calls within the debounce
 * window collapse into a single trailing job.
 *
 * Returns the job id that will eventually run, or null if a backfill is
 * actively migrating this namespace and the caller is a live write that
 * the backfill will pick up.
 */
export async function enqueueWikiIngest(workspaceId: string, source: WikiSource): Promise<string> {
  // Determine which mode the namespace is running in. If it's 'search' (the
  // legacy default for existing workspaces), we still record the trigger
  // event but don't actually run the ingest — the page would be invisible
  // to agents anyway.
  const mode = await getNamespaceMode(workspaceId, source.namespace);
  if (mode === 'search') {
    logger.debug('Skipping wiki ingest (namespace mode = search)', {
      workspaceId, namespace: source.namespace, sourceKind: source.source_kind, sourceId: source.source_id,
    });
    return '';
  }

  const id = uuid();
  await execute(
    `INSERT INTO kb_ingest_jobs (id, workspace_id, namespace, source_kind, source_id, revision, status, triggered_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
    [id, workspaceId, source.namespace, source.source_kind, source.source_id, source.revision || null, source.triggered_by || 'system'],
  );

  // Debounce: if a job for this same source landed in the last few seconds,
  // skip queue insertion. The earlier job will pick up the latest revision
  // when it actually runs (it re-reads source state).
  const redis = getRedisConnection();
  const dedupKey = rkey(workspaceId, 'kb-ingest', source.namespace, source.source_kind, source.source_id);
  const ok = await redis.set(dedupKey, id, 'EX', DEBOUNCE_TTL_SECONDS, 'NX');
  if (ok === null) {
    logger.debug('Wiki ingest debounced', { workspaceId, dedupKey });
    return id;
  }

  await getIngestQueue().add('ingest', {
    jobId: id,
    workspaceId,
    source,
  } satisfies IngestJobPayload, {
    delay: DEBOUNCE_DELAY_MS,
    jobId: id,
    attempts: 1,            // we manage retries ourselves so we can re-load source state
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  });

  logger.info('Wiki ingest enqueued', {
    jobId: id, workspaceId, namespace: source.namespace,
    sourceKind: source.source_kind, sourceId: source.source_id,
  });
  return id;
}

/** Mark a source's wiki page as archived (deleted upstream). */
export async function archiveWikiSourcePage(
  workspaceId: string,
  namespace: WikiSource['namespace'],
  sourceKind: WikiSource['source_kind'],
  sourceId: string,
): Promise<void> {
  await execute(
    `UPDATE kb_wiki_pages SET archived_at = NOW(), updated_at = NOW(), updated_by = 'system'
      WHERE workspace_id = $1
        AND namespace = $2
        AND source_ref->>'source_kind' = $3
        AND source_ref->>'source_id' = $4
        AND archived_at IS NULL`,
    [workspaceId, namespace, sourceKind, sourceId],
  );
  logger.info('Wiki source page archived', { workspaceId, namespace, sourceKind, sourceId });
}

export type NamespaceMode = 'wiki' | 'search' | 'both';

export async function getNamespaceMode(workspaceId: string, namespace: WikiSource['namespace']): Promise<NamespaceMode> {
  const key = `${namespace}.mode`;
  const row = await queryOne<{ value: string }>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, key],
  );
  const v = (row?.value || '').toLowerCase();
  if (v === 'wiki' || v === 'search' || v === 'both') return v;
  // Default for new workspaces: wiki. Existing workspaces (where the table
  // existed before this plan landed) are migrated by the bootstrap to 'search'.
  return 'wiki';
}

export async function setNamespaceMode(
  workspaceId: string,
  namespace: WikiSource['namespace'],
  mode: NamespaceMode,
): Promise<void> {
  await execute(
    `INSERT INTO workspace_settings (workspace_id, key, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [workspaceId, `${namespace}.mode`, mode],
  );
}
