import { PoolClient } from 'pg';
import { withTransaction, execute, query } from '../../db';
import { logger } from '../../utils/logger';

// Workspace IDs are Slack team IDs (e.g. "T012AB3CD"). Postgres identifiers
// must match [A-Za-z_][A-Za-z0-9_]*; we hash-sanitize workspace ids by
// lowercasing and stripping anything that isn't alphanumeric/underscore.
// Collisions are vanishingly unlikely because Slack team IDs are already
// alphanumeric — this is a safety net for synthetic test ids.
export function schemaFor(workspaceId: string): string {
  const clean = workspaceId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return `ws_${clean}`;
}

// Postgres identifiers are validated against a strict allowlist before being
// interpolated into SQL. This is the ONLY place we interpolate — every other
// value must flow through $1/$2 parameterization.
const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Best-effort column-name sanitizer. Applied to sheet/CSV headers BEFORE
 * `assertIdent`, so a header like "Contract Signed?" or "Q1 Revenue (USD)"
 * imports as `contract_signed` / `q1_revenue_usd` instead of failing the
 * whole import. Empty/all-symbol headers fall back to `column_<index>`.
 */
export function sanitizeColumnName(raw: string, fallbackIndex: number): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (!cleaned) return `column_${fallbackIndex}`;
  // Ensure starts with a letter or underscore (Postgres ident rule).
  return /^[a-z_]/.test(cleaned) ? cleaned.slice(0, 60) : `col_${cleaned}`.slice(0, 60);
}

export function assertIdent(name: string, kind: 'table' | 'column' | 'schema'): string {
  const lower = name.toLowerCase();
  if (!IDENT_RE.test(lower)) {
    throw new Error(`Invalid ${kind} name: ${name}. Use lowercase letters, digits, and underscores.`);
  }
  if (RESERVED_IDENTS.has(lower)) {
    throw new Error(`"${name}" is a reserved identifier — pick another ${kind} name.`);
  }
  return lower;
}

// Small denylist: column names that collide with the implicit columns every
// table gets, plus a few common Postgres reserved words that would break
// unquoted SQL. Names the user might legitimately want (e.g. "user") are
// allowed and quoted at call sites.
const RESERVED_IDENTS = new Set([
  'id', 'created_at', 'updated_at',
]);

export async function ensureSchemaExists(workspaceId: string): Promise<string> {
  const schema = schemaFor(workspaceId);
  await execute(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  return schema;
}

export async function dropSchemaIfEmpty(workspaceId: string): Promise<void> {
  const schema = schemaFor(workspaceId);
  const rows = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1`,
    [schema],
  );
  if ((rows[0]?.count ?? 0) === 0) {
    await execute(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  }
}

export interface IntrospectedColumn {
  name: string;
  data_type: string;
  is_nullable: boolean;
}

export async function listPhysicalColumns(
  workspaceId: string,
  tableName: string,
): Promise<IntrospectedColumn[]> {
  const schema = schemaFor(workspaceId);
  assertIdent(tableName, 'table');
  const rows = await query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, tableName.toLowerCase()],
  );
  return rows.map(r => ({
    name: r.column_name,
    data_type: r.data_type,
    is_nullable: r.is_nullable === 'YES',
  }));
}

export async function listPhysicalTables(workspaceId: string): Promise<string[]> {
  const schema = schemaFor(workspaceId);
  const rows = await query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schema],
  );
  return rows.map(r => r.table_name);
}

export async function withWorkspaceClient<T>(
  workspaceId: string,
  fn: (client: PoolClient, schema: string) => Promise<T>,
): Promise<T> {
  const schema = await ensureSchemaExists(workspaceId);
  return withTransaction(async (client) => {
    await client.query(`SET LOCAL search_path = "${schema}"`);
    return fn(client, schema);
  });
}

export function log(message: string, meta: Record<string, any>): void {
  logger.info(`[database] ${message}`, meta);
}
