import { assertIdent, withWorkspaceClient, listPhysicalColumns } from './schema';
import { getTableByName } from './tables';

export interface SelectOptions {
  where?: Record<string, any>;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  columns?: string[];
}

export async function selectRows(
  workspaceId: string,
  tableName: string,
  opts: SelectOptions = {},
): Promise<{ rows: any[]; total: number }> {
  const name = assertIdent(tableName, 'table');
  const t = await getTableByName(workspaceId, name);
  if (!t) throw new Error(`Table not found: ${tableName}`);

  const physicalCols = (await listPhysicalColumns(workspaceId, name)).map(c => c.name);
  const selectCols = (opts.columns && opts.columns.length > 0)
    ? opts.columns.map(c => assertIdent(c, 'column')).filter(c => physicalCols.includes(c))
    : physicalCols;
  if (selectCols.length === 0) throw new Error('No selectable columns.');

  const params: any[] = [];
  const wheres: string[] = [];
  if (opts.where) {
    for (const [k, v] of Object.entries(opts.where)) {
      const colName = assertIdent(k, 'column');
      if (!physicalCols.includes(colName)) continue;
      params.push(v);
      wheres.push(`"${colName}" = $${params.length}`);
    }
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const orderBy = opts.orderBy ? assertIdent(opts.orderBy, 'column') : 'id';
  const orderDir = opts.orderDir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(opts.limit ?? 100, 1000);
  const offset = Math.max(opts.offset ?? 0, 0);

  return withWorkspaceClient(workspaceId, async (client) => {
    const countRes = await client.query(`SELECT count(*)::int AS count FROM "${name}" ${whereSql}`, params);
    const total = countRes.rows[0]?.count ?? 0;
    const colList = selectCols.map(c => `"${c}"`).join(', ');
    const res = await client.query(
      `SELECT ${colList} FROM "${name}" ${whereSql} ORDER BY "${orderBy}" ${orderDir} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return { rows: res.rows, total };
  });
}

export async function insertRow(
  workspaceId: string,
  tableName: string,
  values: Record<string, any>,
): Promise<{ id: number }> {
  const name = assertIdent(tableName, 'table');
  const t = await getTableByName(workspaceId, name);
  if (!t) throw new Error(`Table not found: ${tableName}`);
  const physicalCols = (await listPhysicalColumns(workspaceId, name)).map(c => c.name);

  const cols: string[] = [];
  const placeholders: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(values)) {
    const colName = assertIdent(k, 'column');
    if (!physicalCols.includes(colName)) continue;
    if (['id', 'created_at', 'updated_at'].includes(colName)) continue;
    cols.push(`"${colName}"`);
    params.push(v);
    placeholders.push(`$${params.length}`);
  }
  if (cols.length === 0) throw new Error('No writable columns provided.');

  return withWorkspaceClient(workspaceId, async (client) => {
    const res = await client.query(
      `INSERT INTO "${name}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      params,
    );
    return { id: res.rows[0].id };
  });
}

export async function updateRow(
  workspaceId: string,
  tableName: string,
  id: number,
  values: Record<string, any>,
): Promise<{ updated: number }> {
  const name = assertIdent(tableName, 'table');
  const t = await getTableByName(workspaceId, name);
  if (!t) throw new Error(`Table not found: ${tableName}`);
  const physicalCols = (await listPhysicalColumns(workspaceId, name)).map(c => c.name);

  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(values)) {
    const colName = assertIdent(k, 'column');
    if (!physicalCols.includes(colName)) continue;
    if (['id', 'created_at'].includes(colName)) continue;
    params.push(v);
    sets.push(`"${colName}" = $${params.length}`);
  }
  if (sets.length === 0) throw new Error('No writable columns provided.');
  sets.push(`updated_at = NOW()`);
  params.push(id);

  return withWorkspaceClient(workspaceId, async (client) => {
    const res = await client.query(
      `UPDATE "${name}" SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    return { updated: res.rowCount || 0 };
  });
}

export async function deleteRow(
  workspaceId: string,
  tableName: string,
  id: number,
): Promise<{ deleted: number }> {
  const name = assertIdent(tableName, 'table');
  const t = await getTableByName(workspaceId, name);
  if (!t) throw new Error(`Table not found: ${tableName}`);
  return withWorkspaceClient(workspaceId, async (client) => {
    const res = await client.query(`DELETE FROM "${name}" WHERE id = $1`, [id]);
    return { deleted: res.rowCount || 0 };
  });
}

export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface AggregateOptions {
  fn: AggregateFn;
  column?: string;
  groupBy?: string;
  where?: Record<string, any>;
  limit?: number;
}

export async function aggregate(
  workspaceId: string,
  tableName: string,
  opts: AggregateOptions,
): Promise<{ rows: any[] }> {
  const name = assertIdent(tableName, 'table');
  const t = await getTableByName(workspaceId, name);
  if (!t) throw new Error(`Table not found: ${tableName}`);
  const physicalCols = (await listPhysicalColumns(workspaceId, name)).map(c => c.name);

  const fn = opts.fn;
  if (!['count', 'sum', 'avg', 'min', 'max'].includes(fn)) {
    throw new Error(`Unsupported aggregate function: ${fn}`);
  }

  let expr: string;
  if (fn === 'count') {
    expr = opts.column ? `COUNT("${assertIdent(opts.column, 'column')}")` : 'COUNT(*)';
  } else {
    if (!opts.column) throw new Error(`${fn} requires a column.`);
    const col = assertIdent(opts.column, 'column');
    if (!physicalCols.includes(col)) throw new Error(`Column not found: ${opts.column}`);
    expr = `${fn.toUpperCase()}("${col}")`;
  }

  const params: any[] = [];
  const wheres: string[] = [];
  if (opts.where) {
    for (const [k, v] of Object.entries(opts.where)) {
      const colName = assertIdent(k, 'column');
      if (!physicalCols.includes(colName)) continue;
      params.push(v);
      wheres.push(`"${colName}" = $${params.length}`);
    }
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const limit = Math.min(opts.limit ?? 500, 5000);

  if (opts.groupBy) {
    const groupCol = assertIdent(opts.groupBy, 'column');
    if (!physicalCols.includes(groupCol)) throw new Error(`Column not found: ${opts.groupBy}`);
    return withWorkspaceClient(workspaceId, async (client) => {
      const res = await client.query(
        `SELECT "${groupCol}" AS group_value, ${expr} AS value
         FROM "${name}" ${whereSql}
         GROUP BY "${groupCol}"
         ORDER BY value DESC NULLS LAST
         LIMIT ${limit}`,
        params,
      );
      return { rows: res.rows };
    });
  }

  return withWorkspaceClient(workspaceId, async (client) => {
    const res = await client.query(`SELECT ${expr} AS value FROM "${name}" ${whereSql}`, params);
    return { rows: res.rows };
  });
}
