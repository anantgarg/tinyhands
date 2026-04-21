/**
 * BullMQ worker for the kb-ingest queue. Started by the main worker
 * process alongside the agent-run worker.
 *
 * Retry policy: up to 2 retries with exponential backoff. Each retry
 * re-loads source state, re-parses, and re-runs the LLM pass. The retry
 * is what handles concurrent-edit conflicts (OptimisticConflictError) —
 * the loser of a race re-reads and re-runs.
 */
import { Worker, Job } from 'bullmq';
import { getRedisConnection } from '../../queue';
import { logger } from '../../utils/logger';
import { queryOne, query } from '../../db';
import { runIngest, markIngestDone, markIngestFailed, type IngestContext } from './ingest';
import { OptimisticConflictError } from './pages';
import { archiveWikiSourcePage, WIKI_INGEST_QUEUE, WIKI_LINT_QUEUE, type IngestJobPayload } from './sources';
import { runLint } from './lint';
import { renderDocContent } from '../kb-parser';
import { notifyIngestSuccess, notifyIngestFailure } from './notify';
import type { WikiSource } from '../../types';

const MAX_RETRIES = 2;

let ingestWorker: Worker | null = null;
let lintWorker: Worker | null = null;

export function createWikiWorkers(): { ingest: Worker; lint: Worker } {
  const concurrency = Math.max(1, parseInt(process.env.WIKI_WORKER_CONCURRENCY || '2', 10));

  if (!ingestWorker) {
    ingestWorker = new Worker<IngestJobPayload>(
      WIKI_INGEST_QUEUE,
      async (job: Job<IngestJobPayload>) => handleIngestJob(job),
      {
        connection: getRedisConnection() as any,
        concurrency,
        lockDuration: 600_000,
        stalledInterval: 120_000,
        maxStalledCount: 3,
      },
    );
    ingestWorker.on('failed', (job, err) => {
      logger.error('kb-ingest job failed', { jobId: job?.id, error: err.message });
    });
    ingestWorker.on('completed', (job) => {
      logger.debug('kb-ingest job completed', { jobId: job.id });
    });
  }

  if (!lintWorker) {
    lintWorker = new Worker<{ workspaceId: string; namespace: 'kb' | 'docs' }>(
      WIKI_LINT_QUEUE,
      async (job) => {
        const { workspaceId, namespace } = job.data;
        const report = await runLint(workspaceId, namespace);
        logger.info('kb-lint completed', report);
        return report;
      },
      { connection: getRedisConnection() as any, concurrency: 1 },
    );
  }

  return { ingest: ingestWorker, lint: lintWorker };
}

async function handleIngestJob(job: Job<IngestJobPayload>): Promise<void> {
  const { jobId, workspaceId, source } = job.data;

  // Reload the job row so we know the retries-so-far.
  const dbJob = await queryOne<any>(`SELECT * FROM kb_ingest_jobs WHERE id = $1`, [jobId]);
  if (!dbJob) {
    logger.warn('kb-ingest job row missing, skipping', { jobId });
    return;
  }
  const retries = dbJob.retries || 0;

  try {
    const raw = await resolveRawForParser(workspaceId, source);
    if (raw == null) {
      // Source vanished between enqueue and now — archive any wiki page.
      await archiveWikiSourcePage(workspaceId, source.namespace, source.source_kind, source.source_id);
      await markIngestDone(jobId, [], 'local');
      return;
    }

    const ctx: IngestContext = {
      workspaceId, jobId, source, rawForParser: raw,
    };
    const result = await runIngest(ctx);
    await markIngestDone(jobId, result.pagesTouched, result.parser);
    void notifyIngestSuccess({
      workspaceId, namespace: source.namespace,
      pagesTouched: result.pagesTouched, parser: result.parser,
      sourceLabel: raw.filename, jobId,
    });
  } catch (err: any) {
    const isConflict = err instanceof OptimisticConflictError;
    const canRetry = retries < MAX_RETRIES;
    if (canRetry) {
      // Increment retries and re-enqueue with backoff.
      await markRetry(jobId, retries + 1, err.message);
      const backoff = isConflict ? 500 : 5_000 * Math.pow(2, retries);
      const { getIngestQueue } = await import('./sources');
      await getIngestQueue().add('ingest', job.data, {
        delay: backoff,
        jobId: `${jobId}-retry-${retries + 1}`,
        attempts: 1,
      });
      logger.warn('kb-ingest retry scheduled', { jobId, retries: retries + 1, isConflict, backoff });
    } else {
      await markIngestFailed(jobId, err.message, retries);
      void notifyIngestFailure({ workspaceId, namespace: source.namespace, jobId, error: err.message });
      throw err;
    }
  }
}

/**
 * Resolve the raw content the parser needs given a WikiSource.
 * Returns null if the source no longer exists.
 */
export async function resolveRawForParser(
  workspaceId: string, source: WikiSource,
): Promise<IngestContext['rawForParser'] | null> {
  if (source.source_kind === 'kb_entry') {
    const row = await queryOne<any>(
      `SELECT title, content FROM kb_entries WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, source.source_id],
    );
    if (!row) return null;
    return { inlineMarkdown: `# ${row.title}\n\n${row.content}` };
  }

  if (source.source_kind === 'document') {
    const doc = await queryOne<any>(
      `SELECT id, type, title, description, content, mime_type, is_archived FROM documents
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, source.source_id],
    );
    if (!doc) return null;
    if (doc.is_archived) return null;

    if (doc.type === 'doc') {
      const content = typeof doc.content === 'string' ? safeJson(doc.content) : doc.content;
      return {
        filename: doc.title,
        inlineDoc: { content },
        inlineMarkdown: `# ${doc.title}\n\n${doc.description || ''}\n\n${renderDocContent(content)}`,
      };
    }
    if (doc.type === 'sheet') {
      const tabs = await query<any>(
        `SELECT name, data, row_count, col_count FROM sheet_tabs WHERE document_id = $1 ORDER BY position`,
        [doc.id],
      );
      const inlineSheetTabs = tabs.map((t: any) => ({
        name: t.name,
        data: typeof t.data === 'string' ? safeJson(t.data) || {} : (t.data || {}),
        row_count: t.row_count,
        col_count: t.col_count,
      }));
      return {
        filename: doc.title,
        inlineDoc: { sheetTabs: inlineSheetTabs },
      };
    }
    if (doc.type === 'file') {
      const file = await queryOne<any>(`SELECT data FROM document_files WHERE document_id = $1`, [doc.id]);
      if (!file) return null;
      return {
        filename: doc.title,
        mime: doc.mime_type || 'application/octet-stream',
        bytes: Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data),
      };
    }
    return null;
  }

  if (source.source_kind === 'drive_file') {
    // Drive files are stored in kb_source_files keyed by source_external_id.
    const row = await queryOne<any>(
      `SELECT filename, mime, bytes FROM kb_source_files
         WHERE workspace_id = $1 AND source_external_id = $2`,
      [workspaceId, source.source_id],
    );
    if (!row) {
      // Fall back to the kb_entries inline text (Google Doc/Sheet exports already stored as text).
      const fallback = await queryOne<any>(
        `SELECT title, content FROM kb_entries WHERE workspace_id = $1 AND source_external_id = $2`,
        [workspaceId, source.source_id],
      );
      if (!fallback) return null;
      return { inlineMarkdown: `# ${fallback.title}\n\n${fallback.content}` };
    }
    return {
      filename: row.filename,
      mime: row.mime,
      bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes),
    };
  }

  return null;
}

async function markRetry(jobId: string, retries: number, error: string): Promise<void> {
  const { execute } = await import('../../db');
  await execute(
    `UPDATE kb_ingest_jobs SET retries = $1, error = $2, status = 'queued', updated_at = NOW() WHERE id = $3`,
    [retries, error.slice(0, 1_000), jobId],
  );
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

export async function shutdownWikiWorkers(): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (ingestWorker) tasks.push(ingestWorker.close().then(() => { ingestWorker = null; }));
  if (lintWorker) tasks.push(lintWorker.close().then(() => { lintWorker = null; }));
  await Promise.all(tasks);
}
