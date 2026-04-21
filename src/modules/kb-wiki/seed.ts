/**
 * Seed default wiki pages (index.md, log.md, schema.md) per namespace.
 *
 * Idempotent: only inserts pages that don't exist yet. Safe to call on
 * every ingest entry-point as a defensive measure, but the natural
 * trigger is the first ingest job for a workspace+namespace pair.
 */
import { upsertPage, getPage } from './pages';
import type { WikiNamespace } from '../../types';

const KB_SCHEMA_DEFAULT = `# Knowledge Base — Schema

This is the canonical knowledge surface for the workspace. Pages here are
admin-curated reference material derived from KB articles and Google Drive
sync. End users do not write here directly.

## Page kinds
- \`index.md\` — listing of every page, by category, one line each. Updated on every ingest.
- \`log.md\` — append-only chronological record. One entry per ingest, lint, or admin edit.
- \`schema.md\` — this file. Edit to change naming or workflow.
- \`sources/<slug>.md\` — one per upstream source (KB article or Drive file). Summary, key facts, link back to the original. Slug is kebab-cased title; collisions disambiguated with a numeric suffix.
- \`entities/<slug>.md\` — one per real-world thing the company tracks: customer, product, vendor, person, system. Synthesized across sources.
- \`concepts/<slug>.md\` — one per recurring topic or process: pricing, onboarding, escalation policy, SLA. Synthesized across sources.

## Ingest workflow
On a new or updated source: write/refresh the \`sources/*.md\` page, touch any
\`entities/*.md\` and \`concepts/*.md\` pages whose subject is mentioned, update
\`index.md\`, and append a \`log.md\` entry. Cap touches at 15 per source.

## Lint workflow
Nightly: scan for contradictions across pages, stale claims (a \`sources/*.md\`
referenced from an entity page no longer exists), orphan pages, and missing
cross-references. Auto-apply fixes when \`kb.lint.auto_apply = true\`; otherwise
queue for admin review.
`;

const DOCS_SCHEMA_DEFAULT = `# Documents — Schema

This is the active workspace surface. Pages here reflect docs, sheets, and
files that users and agents are creating, editing, and uploading. Content
turns over more quickly than the Knowledge Base.

## Page kinds
- \`index.md\`, \`log.md\`, \`schema.md\` — same as KB.
- \`sources/<slug>.md\` — one per \`documents\` row (native doc, native sheet, or uploaded file). Summary plus structured highlights (sheet tabs as Markdown tables, doc headings, attached file inventory).
- \`entities/<slug>.md\` — real-world subjects mentioned across documents.
- \`concepts/<slug>.md\` — recurring work topics: ongoing projects, drafts, decisions in progress.

## Ingest workflow
Same shape as KB. Triggered by every write through the Documents module
(user or agent), every upload, and every replace-file operation.

## Lint workflow
Nightly. More tolerant of churn than KB lint — drafts and in-progress work
are expected to contradict themselves.
`;

const KB_INDEX_SEED = `# Knowledge Base — Index

The KB wiki has just been enabled. Pages will appear here as KB articles
are added and Google Drive files are synced.

## Sources
_(none yet)_

## Entities
_(none yet)_

## Concepts
_(none yet)_
`;

const DOCS_INDEX_SEED = `# Documents — Index

The Documents wiki has just been enabled. Pages will appear here as docs,
sheets, and files are created or uploaded.

## Sources
_(none yet)_

## Entities
_(none yet)_

## Concepts
_(none yet)_
`;

const LOG_SEED = (namespace: WikiNamespace) =>
  `# ${namespace === 'kb' ? 'Knowledge Base' : 'Documents'} — Log\n\n` +
  `- ${new Date().toISOString()} — wiki enabled for this namespace.\n`;

export async function seedNamespace(workspaceId: string, namespace: WikiNamespace): Promise<void> {
  const schemaPath = 'schema.md';
  const indexPath = 'index.md';
  const logPath = 'log.md';

  if (!(await getPage(workspaceId, namespace, schemaPath))) {
    await upsertPage(workspaceId, namespace, {
      path: schemaPath,
      kind: 'schema',
      title: namespace === 'kb' ? 'Knowledge Base — Schema' : 'Documents — Schema',
      content: namespace === 'kb' ? KB_SCHEMA_DEFAULT : DOCS_SCHEMA_DEFAULT,
      updated_by: 'system',
      rationale: 'Seeded default schema',
    });
  }

  if (!(await getPage(workspaceId, namespace, indexPath))) {
    await upsertPage(workspaceId, namespace, {
      path: indexPath,
      kind: 'index',
      title: namespace === 'kb' ? 'Knowledge Base — Index' : 'Documents — Index',
      content: namespace === 'kb' ? KB_INDEX_SEED : DOCS_INDEX_SEED,
      updated_by: 'system',
      rationale: 'Seeded default index',
    });
  }

  if (!(await getPage(workspaceId, namespace, logPath))) {
    await upsertPage(workspaceId, namespace, {
      path: logPath,
      kind: 'log',
      title: namespace === 'kb' ? 'Knowledge Base — Log' : 'Documents — Log',
      content: LOG_SEED(namespace),
      updated_by: 'system',
      rationale: 'Seeded default log',
    });
  }
}
