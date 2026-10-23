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
