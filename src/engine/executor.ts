import { DataType, type Table } from 'apache-arrow';

import { adHocWhere } from './adhoc';
import { isNormalized, normalizingReplace } from './normalize';
import { type CachedSchema, SchemaCache, UNSTABLE } from './schemaCache';
import { maskStringLiterals, quoteIdent, quoteLiteral, stripTrailingSemicolons } from './sql';
import type { AdHocFilter, ColumnInfo, SqlRunner } from './types';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** One schema cache per DuckDB: the page's engine in the browser, each runner in tests. */
const caches = new WeakMap<SqlRunner, SchemaCache>();

function schemasOf(runner: SqlRunner): SchemaCache {
  let schemas = caches.get(runner);
  if (!schemas) {
    schemas = new SchemaCache();
    caches.set(runner, schemas);
  }
  return schemas;
}

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
 *
 * The columns come from a DESCRIBE, one more trip to DuckDB's worker, so they
 * are remembered by the statement's shape (its SQL with string literals
 * masked: a variable's new value keeps the shape, a dataset's new table
 * doesn't). A remembered set is only kept when the result proves it still
 * holds (see `reuse`); otherwise the statement is described and run afresh,
 * exactly as without the cache.
 */
export async function runPanelQuery(
  runner: SqlRunner,
  sql: string,
  options: { filters?: AdHocFilter[]; signal?: AbortSignal } = {}
): Promise<PanelQueryResult> {
  const started = now();
  const base = stripTrailingSemicolons(sql);
  const filters = options.filters ?? [];
  const schemas = schemasOf(runner);
  const key = maskStringLiterals(base);
  const cached = schemas.get(key);
  const remembered = cached !== UNSTABLE ? cached : undefined;

  let reused: Reused | undefined;
  if (remembered) {
    reused = await reuse(runner, base, remembered, filters, options.signal);
    if (reused.outcome === 'proven') {
      return { table: reused.table, executed: reused.executed, columns: remembered.columns, ms: now() - started };
    }
  }

  let columns: ColumnInfo[];
  try {
    columns = await describe(runner, base);
  } catch {
    schemas.delete(key);
    const table = await runner.query(base, options.signal);
    return { table, executed: base, columns: [], ms: now() - started };
  }
  if (remembered && reused?.outcome === 'unproven' && sameColumns(remembered.columns, columns)) {
    // The empty result never evaluated the assertion, but DESCRIBE has just
    // shown it holds: a fresh wrapper would be the very query that ran, minus
    // an assertion that removes no rows. Its empty result is the answer.
    return { table: reused.table, executed: reused.executed, columns: remembered.columns, ms: now() - started };
  }
  // Columns that moved with the values, or a result the wrapper can't
  // reproduce, would fail every reuse: describe this statement every time.
  const unstable =
    cached === UNSTABLE ||
    (remembered !== undefined && (reused?.outcome === 'mismatch' || !sameColumns(remembered.columns, columns)));
  if (unstable) {
    schemas.set(key, UNSTABLE);
  }
  const executed = wrap(base, columns, filters);
  const table = await runner.query(executed, options.signal);
  if (!unstable) {
    schemas.set(key, remember(columns, table));
  }
  return { table, executed, columns, ms: now() - started };
}

type Reused = { outcome: 'proven' | 'unproven'; table: Table; executed: string } | { outcome: 'error' | 'mismatch' };

/**
 * Runs `base` wrapped with remembered columns, and keeps the result only when
 * it proves a fresh DESCRIBE would have built the same wrapper:
 *
 * - the result's field names and Arrow types match the ones the columns were
 *   remembered with, so the ad hoc filters that apply are the same, and no
 *   column newly needs a cast;
 * - a column whose DuckDB type the result can't show (one the wrapper casts,
 *   or one Arrow carries as binary: BLOB, BIT and GEOMETRY alike) is asserted
 *   with `typeof`, which DuckDB folds away while it holds. An empty result
 *   never evaluates the assertion, so it proves nothing when there is one:
 *   it comes back `unproven`, for a DESCRIBE to vouch for.
 *
 * Any error is left to the fresh run, which gives the error of today.
 */
async function reuse(
  runner: SqlRunner,
  base: string,
  cached: CachedSchema,
  filters: AdHocFilter[],
  signal?: AbortSignal
): Promise<Reused> {
  const executed = wrap(base, cached.columns, filters, cached.asserted);
  let table: Table;
  try {
    table = await runner.query(executed, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return { outcome: 'error' };
  }
  if (shapeOf(table) !== cached.shape) {
    return { outcome: 'mismatch' };
  }
  const outcome = cached.asserted.length > 0 && table.numRows === 0 ? 'unproven' : 'proven';
  return { outcome, table, executed };
}

function wrap(base: string, columns: ColumnInfo[], filters: AdHocFilter[], asserted: ColumnInfo[] = []): string {
  let executed = base;
  const names = columns.map((c) => c.name);
  const conditions = [adHocWhere(filters, names), typeAssertion(asserted)].filter((c): c is string => c !== undefined);
  if (conditions.length > 0) {
    executed = `SELECT * FROM (${executed}) AS q WHERE ${conditions.join(' AND ')}`;
  }
  const replace = normalizingReplace(columns);
  if (replace) {
    executed = `SELECT * REPLACE (${replace}) FROM (${executed}) AS n`;
  }
  return executed;
}

function typeAssertion(columns: ColumnInfo[]): string | undefined {
  if (columns.length === 0) {
    return undefined;
  }
  const holds = columns.map(({ name, type }) => `typeof(${quoteIdent(name)}) = ${quoteLiteral(type)}`).join(' AND ');
  return `CASE WHEN ${holds} THEN true ELSE error('the remembered columns no longer hold') END`;
}

function remember(columns: ColumnInfo[], table: Table): CachedSchema {
  const fields = table.schema.fields;
  const asserted = columns.filter((column, i) => isNormalized(column) || isBinary(fields[i]?.type));
  return { columns, shape: shapeOf(table), asserted };
}

function isBinary(type: DataType | undefined): boolean {
  return DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type);
}

function shapeOf(table: Table): string {
  return JSON.stringify(table.schema.fields.map((f) => [f.name, String(f.type), [...f.metadata]]));
}

function sameColumns(a: ColumnInfo[], b: ColumnInfo[]): boolean {
  return a.length === b.length && a.every((column, i) => column.name === b[i].name && column.type === b[i].type);
}
