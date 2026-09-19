import type { Table } from 'apache-arrow';

import { adHocWhere } from './adhoc';
import { normalizingReplace } from './normalize';
import { stripTrailingSemicolons } from './sql';
import type { AdHocFilter, ColumnInfo, SqlRunner } from './types';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** The columns of any SELECT, without running it: DESCRIBE only binds the query. */
export async function describe(runner: SqlRunner, sql: string): Promise<ColumnInfo[]> {
  const result = await runner.query(`DESCRIBE SELECT * FROM (${stripTrailingSemicolons(sql)}) AS q`);
  return result.toArray().map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
}

export interface PanelQueryResult {
  table: Table;
  /** The SQL that actually ran, for the Query inspector. */
  executed: string;
  columns: ColumnInfo[];
  ms: number;
}

/**
 * Runs one panel's SQL. It wraps the ad hoc filters that apply and casts the
 * column types a DataFrame can't carry. A statement DESCRIBE can't wrap
 * (PRAGMA, SHOW…) runs as written; if it is simply wrong, running it is what
 * produces the useful error.
 */
export async function runPanelQuery(
  runner: SqlRunner,
  sql: string,
  options: { filters?: AdHocFilter[]; signal?: AbortSignal } = {}
): Promise<PanelQueryResult> {
  const started = now();
  const base = stripTrailingSemicolons(sql);
  let columns: ColumnInfo[];
  try {
    columns = await describe(runner, base);
  } catch {
    const table = await runner.query(base, options.signal);
    return { table, executed: base, columns: [], ms: now() - started };
  }
  let executed = base;
  const where = adHocWhere(options.filters ?? [], columns.map((c) => c.name));
  if (where) {
    executed = `SELECT * FROM (${executed}) AS q WHERE ${where}`;
  }
  const replace = normalizingReplace(columns);
  if (replace) {
    executed = `SELECT * REPLACE (${replace}) FROM (${executed}) AS n`;
  }
  const table = await runner.query(executed, options.signal);
  return { table, executed, columns, ms: now() - started };
}
