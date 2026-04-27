import { withWorkspaceClient, schemaFor } from './schema';
import { getSetting } from '../workspace-settings';

// Read-only SQL runner for the agent tool. Rejects anything that is not a
// single SELECT / WITH ... SELECT statement, opens a transaction with
// SET LOCAL default_transaction_read_only = on, and enforces a statement
// timeout. This is the ONLY agent-reachable path that touches Postgres with
// a free-form query; writes always go through structured insert/update/delete
// so they can flow through the write_policy approval gates.

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ROWS = 1000;

const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'TRUNCATE',
  'CREATE', 'DROP', 'ALTER', 'GRANT', 'REVOKE',
  'COPY', 'VACUUM', 'ANALYZE', 'CLUSTER', 'REINDEX',
  'LOCK', 'COMMENT', 'SECURITY', 'SET', 'RESET',
  'EXECUTE', 'CALL', 'PREPARE', 'DEALLOCATE',
  'LISTEN', 'NOTIFY', 'UNLISTEN',
  'DISCARD', 'LOAD', 'REFRESH',
];

// Strip SQL string literals and comments so keyword detection doesn't trip on
// text inside quoted strings (e.g. SELECT 'INSERT'). We do this without a
// full parser because we only care about keyword safety — all identifiers
// still get validated downstream.
function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === '-' && n === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== '"') j++;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export class SqlReadOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlReadOnlyError';
  }
}

export function validateReadOnly(sqlText: string): void {
  const trimmed = sqlText.trim().replace(/;+\s*$/, '');
  if (!trimmed) throw new SqlReadOnlyError('Empty SQL statement.');

  // Reject multiple statements outright.
  const stripped = stripLiteralsAndComments(trimmed);
  if (stripped.includes(';')) {
    throw new SqlReadOnlyError('Multiple statements are not allowed. Submit a single SELECT.');
  }

  const upper = stripped.toUpperCase();
  const firstKeyword = (upper.match(/\b([A-Z]+)\b/) || [])[1];
  if (firstKeyword !== 'SELECT' && firstKeyword !== 'WITH') {
    throw new SqlReadOnlyError(`Only SELECT / WITH … SELECT queries are allowed (got: ${firstKeyword || 'unknown'}).`);
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      throw new SqlReadOnlyError(`"${kw}" is not allowed in the read-only SQL runner. Use the structured insert/update/delete operations instead.`);
    }
  }

  // WITH queries may contain data-modifying CTEs (INSERT/UPDATE/DELETE). We
  // already blocked those as forbidden keywords above, so this is redundant
  // but explicit: the final statement after the CTE must still be a SELECT.
  if (firstKeyword === 'WITH' && !/\)\s*SELECT\b/i.test(trimmed)) {
    throw new SqlReadOnlyError('WITH queries must end with a SELECT.');
  }
}

export async function runReadOnlySql(
  workspaceId: string,
  sqlText: string,
): Promise<{ rows: any[]; rowCount: number }> {
  validateReadOnly(sqlText);

  const timeoutMs = Number(await getSetting(workspaceId, 'database_statement_timeout_ms')) || DEFAULT_TIMEOUT_MS;
  const maxRows = Number(await getSetting(workspaceId, 'database_max_rows')) || DEFAULT_MAX_ROWS;
  const schema = schemaFor(workspaceId);

  return withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`SET LOCAL default_transaction_read_only = on`);
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, timeoutMs)}`);
    // Pin search_path to ONLY this workspace's schema — no public, no
    // pg_catalog-for-user-tables. This blocks `SELECT * FROM ws_other.foo`
    // unless the user fully qualifies with a schema name that isn't ours,
    // which we then reject via the identifier guard below.
    await client.query(`SET LOCAL search_path = "${schema}"`);

    // Block cross-schema reads: reject any fully-qualified identifier that
    // names a schema other than this workspace's. The agent can still say
    // `FROM customers` (unqualified) or `FROM "${schema}".customers`.
    const qualifiedSchemaRe = /\b([a-z_][a-z0-9_]*)\.[a-z_"]/gi;
    const stripped = stripLiteralsAndComments(sqlText);
    let m;
    while ((m = qualifiedSchemaRe.exec(stripped)) !== null) {
      const referenced = m[1].toLowerCase();
      if (referenced !== schema && referenced !== 'information_schema' && referenced !== 'pg_catalog') {
        throw new SqlReadOnlyError(`Cross-schema references are not allowed. Only this workspace's tables are visible.`);
      }
    }

    const res = await client.query(sqlText);
    const rows = Array.isArray(res.rows) ? res.rows.slice(0, maxRows) : [];
    return { rows, rowCount: res.rowCount || rows.length };
  });
}
