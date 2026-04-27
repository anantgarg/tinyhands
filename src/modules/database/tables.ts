import { v4 as uuid } from 'uuid';
import { query, queryOne, execute } from '../../db';
import type {
  DatabaseTable, DatabaseColumn, DatabaseColumnType, DatabaseImportSource,
} from '../../types';
import {
  schemaFor, assertIdent, ensureSchemaExists, listPhysicalColumns, withWorkspaceClient,
} from './schema';

const TYPE_MAP: Record<DatabaseColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  bigint: 'BIGINT',
  numeric: 'NUMERIC',
  boolean: 'BOOLEAN',
  timestamptz: 'TIMESTAMPTZ',
  date: 'DATE',
  json: 'JSONB',
};

export function sqlTypeFor(t: DatabaseColumnType): string {
  const sql = TYPE_MAP[t];
  if (!sql) throw new Error(`Unsupported column type: ${t}`);
  return sql;
}

export async function listTables(workspaceId: string): Promise<DatabaseTable[]> {
  return query<DatabaseTable>(
    `SELECT * FROM database_tables WHERE workspace_id = $1 ORDER BY created_at DESC`,
    [workspaceId],
  );
}

export async function getTable(workspaceId: string, id: string): Promise<DatabaseTable | undefined> {
  return queryOne<DatabaseTable>(
    `SELECT * FROM database_tables WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  );
}

export async function getTableByName(workspaceId: string, name: string): Promise<DatabaseTable | undefined> {
  return queryOne<DatabaseTable>(
    `SELECT * FROM database_tables WHERE workspace_id = $1 AND name = $2`,
    [workspaceId, name.toLowerCase()],
  );
}

export interface CreateTableOptions {
  name: string;
  description?: string;
  columns: DatabaseColumn[];
  sourceType?: DatabaseImportSource;
  sourceConfig?: Record<string, any>;
  /** Optional per-column descriptions, keyed by sanitized column name. */
  columnDescriptions?: Record<string, string>;
  createdBy?: string;
}

export async function createTable(
  workspaceId: string,
  opts: CreateTableOptions,
): Promise<DatabaseTable> {
  const tableName = assertIdent(opts.name, 'table');
  if (opts.columns.length === 0) {
    throw new Error('At least one column is required.');
  }
  const seen = new Set<string>();
  const columns = opts.columns.map((c) => {
    const colName = assertIdent(c.name, 'column');
    if (seen.has(colName)) throw new Error(`Duplicate column name: ${c.name}`);
    seen.add(colName);
    return { name: colName, type: c.type, nullable: c.nullable !== false };
  });

  const id = uuid();
  const existing = await getTableByName(workspaceId, tableName);
  if (existing) throw new Error(`A table named "${tableName}" already exists.`);

  await ensureSchemaExists(workspaceId);
  await withWorkspaceClient(workspaceId, async (client) => {
    const colDefs = columns.map((c) => {
      const nullability = c.nullable ? '' : ' NOT NULL';
      return `"${c.name}" ${sqlTypeFor(c.type)}${nullability}`;
    }).join(', ');
    await client.query(
      `CREATE TABLE "${tableName}" (
        id BIGSERIAL PRIMARY KEY,
        ${colDefs},
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    );
  });

  await execute(
    `INSERT INTO database_tables (id, workspace_id, name, description, source_type, source_config, column_descriptions, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id, workspaceId, tableName, opts.description || null,
      opts.sourceType || 'manual', JSON.stringify(opts.sourceConfig || {}),
      JSON.stringify(opts.columnDescriptions || {}),
      opts.createdBy || null,
    ],
  );
  return (await getTable(workspaceId, id))!;
}

export async function deleteTable(workspaceId: string, id: string): Promise<void> {
  const t = await getTable(workspaceId, id);
  if (!t) return;
  const tableName = assertIdent(t.name, 'table');
  await withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`DROP TABLE IF EXISTS "${tableName}"`);
  });
  await execute(`DELETE FROM database_tables WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
}

export async function addColumn(
  workspaceId: string,
  tableId: string,
  column: DatabaseColumn,
): Promise<void> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  const tableName = assertIdent(t.name, 'table');
  const colName = assertIdent(column.name, 'column');
  const sqlType = sqlTypeFor(column.type);
  await withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`ALTER TABLE "${tableName}" ADD COLUMN "${colName}" ${sqlType}`);
  });
  if (column.description !== undefined && column.description !== null) {
    await setColumnDescription(workspaceId, tableId, colName, column.description);
  }
  await touch(workspaceId, tableId);
}

export async function renameColumn(
  workspaceId: string,
  tableId: string,
  from: string,
  to: string,
): Promise<void> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  const tableName = assertIdent(t.name, 'table');
  const fromName = assertIdent(from, 'column');
  const toName = assertIdent(to, 'column');
  await withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`ALTER TABLE "${tableName}" RENAME COLUMN "${fromName}" TO "${toName}"`);
  });
  await touch(workspaceId, tableId);
}

export async function dropColumn(
  workspaceId: string,
  tableId: string,
  column: string,
): Promise<void> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  const tableName = assertIdent(t.name, 'table');
  const colName = assertIdent(column, 'column');
  if (['id', 'created_at', 'updated_at'].includes(colName)) {
    throw new Error('Cannot drop built-in columns.');
  }
  await withWorkspaceClient(workspaceId, async (client) => {
    await client.query(`ALTER TABLE "${tableName}" DROP COLUMN "${colName}"`);
  });
  await touch(workspaceId, tableId);
}

export async function describeTable(workspaceId: string, name: string): Promise<{
  table: DatabaseTable;
  columns: DatabaseColumn[];
} | null> {
  const t = await getTableByName(workspaceId, name);
  if (!t) return null;
  const physical = await listPhysicalColumns(workspaceId, t.name);
  const descriptions = (t.column_descriptions || {}) as Record<string, string>;
  const columns: DatabaseColumn[] = physical.map((c) => ({
    name: c.name,
    type: sqlToLogicalType(c.data_type),
    nullable: c.is_nullable,
    description: descriptions[c.name] || null,
  }));
  return { table: t, columns };
}

export function sqlToLogicalType(pgType: string): DatabaseColumnType {
  switch (pgType.toLowerCase()) {
    case 'text':
    case 'character varying':
    case 'varchar':
      return 'text';
    case 'integer': return 'integer';
    case 'bigint': return 'bigint';
    case 'numeric':
    case 'decimal':
    case 'real':
    case 'double precision':
      return 'numeric';
    case 'boolean': return 'boolean';
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return 'timestamptz';
    case 'date': return 'date';
    case 'json':
    case 'jsonb':
      return 'json';
    default: return 'text';
  }
}

export async function setTableDescription(
  workspaceId: string,
  tableId: string,
  description: string | null,
): Promise<void> {
  await execute(
    `UPDATE database_tables SET description = $1, updated_at = NOW() WHERE workspace_id = $2 AND id = $3`,
    [description, workspaceId, tableId],
  );
}

export async function setColumnDescription(
  workspaceId: string,
  tableId: string,
  column: string,
  description: string | null,
): Promise<void> {
  // jsonb_set with COALESCE so we don't blow away other column entries. When
  // description is null, drop the key entirely.
  if (description === null || description.trim() === '') {
    await execute(
      `UPDATE database_tables SET column_descriptions = column_descriptions - $1, updated_at = NOW()
       WHERE workspace_id = $2 AND id = $3`,
      [column.toLowerCase(), workspaceId, tableId],
    );
    return;
  }
  await execute(
    `UPDATE database_tables
     SET column_descriptions = jsonb_set(COALESCE(column_descriptions, '{}'::jsonb), ARRAY[$1::text], to_jsonb($2::text), true),
         updated_at = NOW()
     WHERE workspace_id = $3 AND id = $4`,
    [column.toLowerCase(), description, workspaceId, tableId],
  );
}

export async function updateSourceConfig(
  workspaceId: string,
  tableId: string,
  patch: Record<string, any>,
): Promise<void> {
  const t = await getTable(workspaceId, tableId);
  if (!t) throw new Error('Table not found');
  const merged = { ...(t.source_config || {}), ...patch };
  await execute(
    `UPDATE database_tables SET source_config = $1, updated_at = NOW() WHERE workspace_id = $2 AND id = $3`,
    [JSON.stringify(merged), workspaceId, tableId],
  );
}

export async function markSynced(
  workspaceId: string,
  tableId: string,
  status: 'success' | 'partial_sync' | 'failed',
): Promise<void> {
  await execute(
    `UPDATE database_tables
     SET last_synced_at = NOW(), last_sync_status = $1, updated_at = NOW()
     WHERE workspace_id = $2 AND id = $3`,
    [status, workspaceId, tableId],
  );
}

async function touch(workspaceId: string, tableId: string): Promise<void> {
  await execute(
    `UPDATE database_tables SET updated_at = NOW() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, tableId],
  );
}

// Resolve a workspace's schema name for use in error messages. Exposed so
// the API surface can show "created in schema ws_T012..." to admins.
export { schemaFor };
