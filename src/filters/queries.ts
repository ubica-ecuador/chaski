import type { Clause } from '../engine/crossfilter';
import { quoteIdent, quoteLiteral } from '../engine/sql';

/*
 * The SQL behind the filters panel, over a dataset's table on the panels'
 * connections. Every control counts rows under every active filter but its
 * own, as `$__crossfilter($f, -own)` does: a control shows what picking in
 * it would give, never only what it already picked.
 */

/** The AND of the active filters, leaving out those named; TRUE when none is left. */
export function whereOf(states: Clause[], without: string[] = [], extra: string[] = []): string {
  const parts = [
    ...states.filter((s) => s.sql !== undefined && !without.includes(s.name)).map((s) => `(${s.sql})`),
    ...extra,
  ];
  return parts.length ? parts.join(' AND ') : 'TRUE';
}

/** The dashboard's time range over a column, as ISO strings: DuckDB casts them to the column's type. */
export function timeCondition(column: string | undefined, from: number, to: number): string[] {
  if (!column) {
    return [];
  }
  const col = quoteIdent(column);
  return [
    `${col} >= ${quoteLiteral(new Date(from).toISOString())}`,
    `${col} < ${quoteLiteral(new Date(to).toISOString())}`,
  ];
}

const counted = (condition: string) => `count(*) FILTER (WHERE ${condition})::DOUBLE`;

/**
 * One row: `total` in the time range, `shown` under every filter, and for each
 * active filter `without_<name>`, the count with it left out. A filter whose
 * count without it equals `shown` narrows nothing (a map's whole window).
 */
export function countSql(table: string, states: Clause[], time: string[]): string {
  const active = states.filter((s) => s.sql !== undefined);
  const columns = [
    'count(*)::DOUBLE AS total',
    `${counted(whereOf(states))} AS shown`,
    ...active.map((s) => `${counted(whereOf(states, [s.name]))} AS ${quoteIdent(`without_${s.name}`)}`),
  ];
  return `SELECT ${columns.join(', ')} FROM ${quoteIdent(table)} WHERE ${whereOf([], [], time)}`;
}

/**
 * A column's values with their counts under the other filters (`n`) and in the
 * time range (`total`), most first; the values already picked come first
 * whatever their count, so they can always be unpicked.
 */
export function valuesSql(
  table: string,
  column: string,
  states: Clause[],
  own: string,
  time: string[],
  picked: string[],
  limit: number
): string {
  const value = `CAST(${quoteIdent(column)} AS VARCHAR)`;
  const first = picked.length ? `(${value} IN (${picked.map(quoteLiteral).join(', ')})) DESC, ` : '';
  return (
    `SELECT ${value} AS value, ${counted(whereOf(states, [own]))} AS n, count(*)::DOUBLE AS total ` +
    `FROM ${quoteIdent(table)} WHERE ${whereOf([], [], [...time, `${quoteIdent(column)} IS NOT NULL`])} ` +
    `GROUP BY 1 ORDER BY ${first}n DESC, total DESC, value LIMIT ${Math.max(1, Math.floor(limit))}`
  );
}

/** A range filter's column as a number: itself, or epoch milliseconds for times. */
export function numericOf(column: string, asTime: boolean): string {
  const col = quoteIdent(column);
  return asTime ? `epoch_ms(CAST(${col} AS TIMESTAMP))::DOUBLE` : `CAST(${col} AS DOUBLE)`;
}

/** The whole dataset's extent of a column: the histogram's axis stays put while filters change. */
export function extentSql(table: string, column: string, asTime: boolean): string {
  const x = numericOf(column, asTime);
  return `SELECT min(${x}) AS lo, max(${x}) AS hi FROM ${quoteIdent(table)}`;
}

/**
 * `bins` equal bins over [lo, hi]: `n` under the other filters, `total` in the
 * time range. Bins with no rows are absent.
 */
export function histogramSql(
  table: string,
  column: string,
  asTime: boolean,
  extent: { lo: number; hi: number },
  bins: number,
  states: Clause[],
  own: string,
  time: string[]
): string {
  const x = numericOf(column, asTime);
  const step = extent.hi > extent.lo ? (extent.hi - extent.lo) / bins : 1;
  const bin = `least(greatest(floor((${x} - ${extent.lo}) / ${step}), 0), ${bins - 1})::INTEGER`;
  return (
    `SELECT ${bin} AS bin, ${counted(whereOf(states, [own]))} AS n, count(*)::DOUBLE AS total ` +
    `FROM ${quoteIdent(table)} WHERE ${whereOf([], [], [...time, `${quoteIdent(column)} IS NOT NULL`])} ` +
    `GROUP BY 1 ORDER BY 1`
  );
}
