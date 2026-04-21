/**
 * Wiki ingest pass — loads source content, parses it, calls the LLM to
 * propose page edits, validates the plan, applies it transactionally
 * inside per-page Redis locks (with optimistic check fallback).
 *
 * See plan-016 §3 for the prompt contract and §13 for concurrency.
 */
import { z } from 'zod';
import { execute, queryOne, query } from '../../db';
import { logger } from '../../utils/logger';
import { createAnthropicClient } from '../anthropic';
import { getModelId } from '../../utils/costs';
import { parseSource } from '../kb-parser';
import { getPage, getPageBySource, upsertPage, OptimisticConflictError } from './pages';
import { acquirePageLocks } from './locks';
import { seedNamespace } from './seed';
import type { WikiNamespace, WikiSource, WikiPage, ParsedSource } from '../../types';

const MAX_PAGE_TOUCHES = 15;

const PageEditSchema = z.object({
  path: z.string().min(1).max(200),
  operation: z.enum(['create', 'update', 'no_op']),
  title: z.string().max(500).optional(),
  content: z.string().max(60_000).optional(),
  expected_prior_revision: z.string().nullable().optional(),
  rationale: z.string().max(500).optional(),
});

const PlanSchema = z.object({
  plan_version: z.literal(1),
  log_entry: z.string().max(2_000),
  page_edits: z.array(PageEditSchema).max(MAX_PAGE_TOUCHES),
});
export type WikiUpdatePlan = z.infer<typeof PlanSchema>;

export interface IngestContext {
  workspaceId: string;
  jobId: string;
  source: WikiSource;
  /** Already-resolved raw bytes / inline content for the source. */
  rawForParser: {
    filename?: string;
    mime?: string;
    bytes?: Buffer;
    inlineMarkdown?: string;
    inlineDoc?: { content?: unknown; sheetTabs?: any[] };
  };
}

/**
 * Run a single ingest pass. Returns the list of page paths touched.
 * On failure, throws — caller (worker) is responsible for retry policy
 * and updating kb_ingest_jobs.status accordingly.
 */
export async function runIngest(ctx: IngestContext): Promise<{ pagesTouched: string[]; parser: string }> {
  await markStatus(ctx.jobId, 'parsing', { parser: null });
  await seedNamespace(ctx.workspaceId, ctx.source.namespace);

  const parsed = await parseSource({
    workspaceId: ctx.workspaceId,
    source: ctx.source,
    filename: ctx.rawForParser.filename,
    mime: ctx.rawForParser.mime,
    bytes: ctx.rawForParser.bytes,
    inlineMarkdown: ctx.rawForParser.inlineMarkdown,
    inlineDoc: ctx.rawForParser.inlineDoc,
  });

  await markStatus(ctx.jobId, 'classifying', { parser: parsed.parser });

  // Build the LLM prompt context.
  const context = await buildPromptContext(ctx.workspaceId, ctx.source.namespace, parsed, ctx.source);
  const plan = await callModel(ctx.workspaceId, context, parsed, ctx.source);

  await markStatus(ctx.jobId, 'wiki_updating', { parser: parsed.parser });

  // Acquire locks for every page the plan wants to touch (plus the always-touched
  // index.md and log.md so concurrent log appends serialize cleanly).
  const targets = [...new Set(['index.md', 'log.md', ...plan.page_edits.map(e => e.path)])];
  const lock = await acquirePageLocks(ctx.workspaceId, ctx.source.namespace, targets);

  const touched: string[] = [];
  try {
    for (const edit of plan.page_edits) {
      if (edit.operation === 'no_op') continue;
      const title = edit.title || edit.path.replace(/^.*\//, '').replace(/\.md$/, '');
      const content = edit.content || '';
      const isSourcePage = edit.path === sourcePagePath(ctx.source);
      const kind = inferKind(edit.path);
      try {
        await upsertPage(ctx.workspaceId, ctx.source.namespace, {
          path: edit.path,
          kind,
          title,
          content,
          expected_prior_revision: edit.expected_prior_revision ?? null,
          source_ref: isSourcePage ? { source_kind: ctx.source.source_kind, source_id: ctx.source.source_id, revision: ctx.source.revision } : null,
          updated_by: ctx.source.triggered_by || 'llm',
          rationale: edit.rationale,
        });
        touched.push(edit.path);
      } catch (err) {
        if (err instanceof OptimisticConflictError) {
          // Conflict — bail; the worker will re-queue with fresh state.
          throw err;
        }
        throw err;
      }
    }

    // Append to log.md
    await appendLog(ctx.workspaceId, ctx.source.namespace, plan.log_entry, ctx.source);
    touched.push('log.md');
  } finally {
    await lock.release();
  }

  return { pagesTouched: [...new Set(touched)], parser: parsed.parser };
}

interface PromptContext {
  schema: string;
  indexSummary: string;
  existingSourcePage: WikiPage | null;
  candidatePages: WikiPage[];
}

async function buildPromptContext(
  workspaceId: string, namespace: WikiNamespace,
  parsed: ParsedSource, source: WikiSource,
): Promise<PromptContext> {
  const schemaPage = await getPage(workspaceId, namespace, 'schema.md');
  const indexPage = await getPage(workspaceId, namespace, 'index.md');
  const existingSource = await getPageBySource(workspaceId, namespace, source.source_kind, source.source_id);

  // Match referenced entities/concepts by case-insensitive title presence
  // in the parsed Markdown — keeps prompt context small.
  const candidates: WikiPage[] = [];
  const allEntCon = await query<any>(
    `SELECT * FROM kb_wiki_pages
       WHERE workspace_id = $1 AND namespace = $2 AND archived_at IS NULL
         AND kind IN ('entity', 'concept')`,
    [workspaceId, namespace],
  );
  const lowerMd = parsed.markdown.toLowerCase();
  for (const row of allEntCon) {
    if (lowerMd.includes(String(row.title).toLowerCase())) candidates.push(row);
    if (candidates.length >= 8) break;          // cap context size
  }

  return {
    schema: schemaPage?.content || '',
    indexSummary: indexPage?.content?.slice(0, 4_000) || '',
    existingSourcePage: existingSource,
    candidatePages: candidates,
  };
}

async function callModel(
  workspaceId: string, ctx: PromptContext,
  parsed: ParsedSource, source: WikiSource,
): Promise<WikiUpdatePlan> {
  const sourcePath = sourcePagePath(source);
  const slug = sourcePath.split('/').pop()!.replace('.md', '');

  const candidateBlocks = ctx.candidatePages.map(p =>
    `### ${p.path}\n\n_revision: ${new Date(p.updated_at).toISOString()}_\n\n${p.content.slice(0, 3_000)}`,
  ).join('\n\n');

  const existingBlock = ctx.existingSourcePage
    ? `### EXISTING ${ctx.existingSourcePage.path}\n\n_revision: ${new Date(ctx.existingSourcePage.updated_at).toISOString()}_\n\n${ctx.existingSourcePage.content.slice(0, 6_000)}`
    : `### NEW source page (no existing)\n\nThe path will be \`${sourcePath}\`.`;

  const systemPrompt = `You maintain a workspace wiki. You are given:
- the wiki's schema (which describes page kinds and naming rules),
- a compact summary of the wiki index,
- the parsed content of a new or updated source,
- the existing source page if one exists,
- and the full bodies of any entity/concept pages whose subject this source mentions.

Return a JSON plan that describes which wiki pages to create or update.

Strict rules:
- Only return pages in the namespace's allowed directories: \`sources/\`, \`entities/\`, \`concepts/\`, plus \`index.md\` and \`log.md\` at the root. Never propose paths outside these.
- The source page itself MUST be at exactly \`${sourcePath}\` (slug \`${slug}\`).
- Keep total page edits ≤ ${MAX_PAGE_TOUCHES}. Use \`no_op\` for pages you considered but didn't change.
- Always update \`index.md\` to list the source page.
- For every UPDATE on an existing page, set \`expected_prior_revision\` to that page's revision exactly as given. For CREATE, leave it null or omit it.
- \`log_entry\` is one paragraph for the log file.

Return ONLY a JSON object matching this shape:
{
  "plan_version": 1,
  "log_entry": "string",
  "page_edits": [
    {
      "path": "sources/foo.md | entities/bar.md | concepts/baz.md | index.md",
      "operation": "create" | "update" | "no_op",
      "title": "string (required for create/update)",
      "content": "string (full Markdown body, required for create/update)",
      "expected_prior_revision": "ISO datetime string | null",
      "rationale": "one short sentence"
    }
  ]
}`;

  const userPrompt = `## Schema\n\n${ctx.schema}\n\n## Index summary\n\n${ctx.indexSummary}\n\n## Source content (parser: ${parsed.parser})\n\n${parsed.markdown.slice(0, 30_000)}\n\n## Existing source page\n\n${existingBlock}\n\n## Related pages (entities & concepts)\n\n${candidateBlocks || '_(none)_'}\n\nReturn the JSON plan now.`;

  const client = await createAnthropicClient(workspaceId);

  // Try Sonnet first, fall back to Opus on validation failure.
  for (const alias of ['sonnet', 'opus'] as const) {
    try {
      const response: any = await (client as any).messages.create({
        model: getModelId(alias),
        max_tokens: 8_000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const text = (response.content || []).map((c: any) => c.text || '').join('').trim();
      const json = extractJson(text);
      const parsed = PlanSchema.safeParse(json);
      if (parsed.success) {
        const validated = enforceNamespaceConstraints(parsed.data, source.namespace, sourcePath);
        return validated;
      }
      logger.warn('Wiki plan failed validation', { alias, issues: parsed.error.issues.slice(0, 3) });
    } catch (err: any) {
      logger.warn('Wiki LLM call failed', { alias, error: err.message });
      if (alias === 'opus') throw err;
    }
  }
  throw new Error('Wiki LLM produced no valid plan after Sonnet + Opus retry');
}

function extractJson(text: string): unknown {
  // Strip markdown code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  return JSON.parse(candidate);
}

function enforceNamespaceConstraints(plan: WikiUpdatePlan, _namespace: WikiNamespace, sourcePath: string): WikiUpdatePlan {
  const ALLOWED_PREFIXES = ['sources/', 'entities/', 'concepts/'];
  const ALLOWED_ROOT = ['index.md', 'log.md', 'schema.md'];
  for (const edit of plan.page_edits) {
    const ok = ALLOWED_ROOT.includes(edit.path) ||
               ALLOWED_PREFIXES.some(p => edit.path.startsWith(p));
    if (!ok) throw new Error(`LLM plan tried to edit out-of-namespace path: ${edit.path}`);
    // Defense-in-depth: source page path MUST be the canonical one.
    if (edit.path.startsWith('sources/') && edit.path !== sourcePath) {
      throw new Error(`LLM plan used wrong source path ${edit.path}, expected ${sourcePath}`);
    }
  }
  return plan;
}

function sourcePagePath(source: WikiSource): string {
  return `sources/${slugify(source.source_id)}.md`;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'source';
}

function inferKind(path: string): WikiPage['kind'] {
  if (path === 'index.md') return 'index';
  if (path === 'log.md') return 'log';
  if (path === 'schema.md') return 'schema';
  if (path.startsWith('sources/')) return 'source';
  if (path.startsWith('entities/')) return 'entity';
  if (path.startsWith('concepts/')) return 'concept';
  return 'source';
}

async function appendLog(
  workspaceId: string, namespace: WikiNamespace,
  entry: string, source: WikiSource,
): Promise<void> {
  const log = await getPage(workspaceId, namespace, 'log.md');
  const entryLine = `- ${new Date().toISOString()} — ${source.source_kind}/${source.source_id}: ${entry}`;
  const newContent = log
    ? `${log.content}\n${entryLine}`.slice(-100_000)
    : `# ${namespace === 'kb' ? 'Knowledge Base' : 'Documents'} — Log\n\n${entryLine}\n`;
  await upsertPage(workspaceId, namespace, {
    path: 'log.md',
    kind: 'log',
    title: log?.title || (namespace === 'kb' ? 'Knowledge Base — Log' : 'Documents — Log'),
    content: newContent,
    expected_prior_revision: log ? new Date(log.updated_at).toISOString() : null,
    updated_by: 'llm',
    rationale: 'append ingest log',
  });
}

async function markStatus(
  jobId: string, status: string,
  extra: { parser?: string | null; error?: string; pagesTouched?: string[] } = {},
): Promise<void> {
  const sets: string[] = ['status = $1', 'updated_at = NOW()'];
  const vals: any[] = [status];
  let idx = 2;
  if (extra.parser !== undefined) {
    sets.push(`parser = $${idx++}`); vals.push(extra.parser);
  }
  if (extra.error !== undefined) {
    sets.push(`error = $${idx++}`); vals.push(extra.error);
  }
  if (extra.pagesTouched) {
    sets.push(`pages_touched = $${idx++}`); vals.push(extra.pagesTouched);
  }
  vals.push(jobId);
  await execute(`UPDATE kb_ingest_jobs SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
}

export async function markIngestDone(jobId: string, pagesTouched: string[], parser: string): Promise<void> {
  await markStatus(jobId, 'done', { pagesTouched, parser });
}

export async function markIngestFailed(jobId: string, error: string, retries: number): Promise<void> {
  await execute(
    `UPDATE kb_ingest_jobs SET status = 'failed', error = $1, retries = $2, updated_at = NOW() WHERE id = $3`,
    [error.slice(0, 1_000), retries, jobId],
  );
}

export async function getIngestJob(jobId: string): Promise<any> {
  return queryOne(`SELECT * FROM kb_ingest_jobs WHERE id = $1`, [jobId]);
}
