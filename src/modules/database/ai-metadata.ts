import { createAnthropicClient } from '../anthropic';
import { logger } from '../../utils/logger';
import type { DatabaseColumn } from '../../types';

export interface SuggestedMetadata {
  name: string;        // snake_case Postgres-safe table name
  description: string; // multi-paragraph explanation aimed at downstream agents
  /** Per-column descriptions, keyed by sanitized column name. */
  columns: Record<string, string>;
}

const SAMPLE_ROWS = 8;
const MAX_VALUE_LEN = 80;

/**
 * Ask Claude to propose a table name and a *detailed* description for the
 * data being imported. The description is what gets injected via
 * `@database:<table>` references at runtime, so a future agent uses it to
 * decide whether this table is relevant — it should describe what each
 * column means, what kind of business object the rows represent, and what
 * questions the table can answer.
 */
export async function suggestTableMetadata(
  workspaceId: string,
  input: {
    headers: string[];
    rows: string[][];
    columns?: DatabaseColumn[];
    /** Optional hint from the source (e.g. CSV file name, sheet title) */
    sourceHint?: string;
  },
): Promise<SuggestedMetadata> {
  const headers = input.headers.map(h => h.trim()).filter(h => h.length > 0);
  if (headers.length === 0) {
    return { name: 'imported_table', description: 'Imported data — describe what it contains.', columns: {} };
  }

  // Sample a handful of rows. Truncate long values so the prompt stays cheap.
  const sample = input.rows.slice(0, SAMPLE_ROWS).map(r =>
    headers.map((_, i) => {
      const v = String(r[i] ?? '');
      return v.length > MAX_VALUE_LEN ? v.slice(0, MAX_VALUE_LEN) + '…' : v;
    }),
  );

  const columnInfo = input.columns
    ? input.columns.map(c => `- ${c.name}: ${c.type}`).join('\n')
    : headers.map(h => `- ${h}`).join('\n');

  const sampleBlock = sample.length > 0
    ? sample.map(r => '| ' + r.map(v => v || '∅').join(' | ') + ' |').join('\n')
    : '(no rows yet)';

  const sanitizedHeaders = headers.map((h, i) => sanitizeColName(h, i + 1));
  const headerMappingNote = headers
    .map((orig, i) => `  ${sanitizedHeaders[i]}  ←  "${orig}"`)
    .join('\n');

  const prompt = `You're naming and describing a database table that's about to be created in a workspace data platform. The table will be visible to AI agents who need to decide whether to use it for answering questions.

${input.sourceHint ? `Source hint: ${input.sourceHint}\n\n` : ''}Columns (sanitized name ← original sheet header):
${headerMappingNote}

Column types:
${columnInfo}

Sample rows:
| ${headers.join(' | ')} |
${sampleBlock}

Respond with a JSON object ONLY (no prose, no markdown fences) with these exact keys:

{
  "name": "snake_case_table_name",
  "description": "<detailed table-level description>",
  "columns": {
    "<sanitized_column_name>": "<one-sentence description of what this column holds>",
    ...
  }
}

Rules:
- name: 2-4 words, snake_case, lowercase letters/digits/underscores only, must start with a letter, max 40 chars. Should describe what each row represents (e.g. "active_customers", "weekly_pipeline", "support_tickets"). Avoid generic names like "data" or "imported".
- description: 2-4 sentences, in plain English. Cover: (1) what one row represents, (2) what the most useful columns mean and any subtle distinctions, (3) typical questions an agent could answer using this table. ~60-150 words. Be specific to the actual columns and sample values.
- columns: keys MUST match the sanitized column names exactly (the left side of the mapping above). Each value is a single concise sentence (≤25 words) explaining what the column means in business terms — not a restatement of the column name. Skip generic columns like id/created_at/updated_at. If a column is ambiguous, say so.

Return ONLY the JSON object.`;

  try {
    const client = await createAnthropicClient(workspaceId);
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    return parseSuggestion(text);
  } catch (err: any) {
    logger.warn('Table metadata suggestion failed, using fallback', { workspaceId, error: err.message });
    return fallbackSuggestion(headers, input.sourceHint);
  }
}

function parseSuggestion(raw: string): SuggestedMetadata {
  // Tolerate fenced code blocks just in case the model ignores instructions.
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON object in response');
  const obj = JSON.parse(text.slice(start, end + 1));
  const name = sanitizeName(String(obj.name || ''));
  const description = String(obj.description || '').trim();
  if (!name) throw new Error('Empty name in response');
  const cols: Record<string, string> = {};
  if (obj.columns && typeof obj.columns === 'object') {
    for (const [k, v] of Object.entries(obj.columns)) {
      if (typeof v === 'string' && v.trim()) cols[k] = String(v).trim();
    }
  }
  return { name, description, columns: cols };
}

// Mirror of `sanitizeColumnName` from ./schema, but inlined here to avoid a
// circular import. Keeps the AI prompt's "sanitized name ← original" mapping
// consistent with what we'll persist at import time.
function sanitizeColName(raw: string, fallbackIndex: number): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!cleaned) return `column_${fallbackIndex}`;
  return /^[a-z_]/.test(cleaned) ? cleaned.slice(0, 60) : `col_${cleaned}`.slice(0, 60);
}

function sanitizeName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!/^[a-z_]/.test(cleaned)) return ''; // must start with letter or underscore
  return cleaned.slice(0, 40);
}

function fallbackSuggestion(headers: string[], hint?: string): SuggestedMetadata {
  // Rule-based fallback when the model is unavailable. Names the table after
  // the source hint or the first non-id column. Description lists columns.
  const candidate = (hint && sanitizeName(hint))
    || sanitizeName(headers.find(h => !/^(id|uuid)$/i.test(h)) || 'imported_table')
    || 'imported_table';
  const cols = headers.slice(0, 6).join(', ');
  return {
    name: candidate,
    description: `Imported data containing the columns: ${cols}${headers.length > 6 ? `, and ${headers.length - 6} more` : ''}. Describe what each row represents so future agents can decide when to use this table.`,
    columns: {},
  };
}
