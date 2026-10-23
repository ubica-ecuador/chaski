import {
  type Clause,
  type DeclaredDataset,
  type FilterDeclaration,
  parseNumber,
  parseTime,
  type RangeFilter,
} from '../engine/crossfilter';
import type { ValueOf } from './model';
import { countSql, extentSql, histogramSql, valuesSql } from './queries';

/*
 * Everything one render of the filters panel shows, read in one go: the rows
 * left, and for each control the counts it needs. A row is a plain object.
 */

export type Row = Record<string, unknown>;
export type Run = (sql: string) => Promise<Row[]>;

export interface ValueCount {
  value: string;
  /** Rows with this value under the other filters. */
  n: number;
  /** Rows with this value in the time range. */
  total: number;
}

export interface Histogram {
  extent: { lo: number; hi: number };
  /** One per bin, in order; empty bins are zeros. */
  n: number[];
  total: number[];
}

export interface PanelData {
  dataset: DeclaredDataset;
  states: Clause[];
  total: number;
  shown: number;
  /** Per active filter: the count with it left out. */
  without: Record<string, number>;
  values: Record<string, ValueCount[]>;
  histograms: Record<string, Histogram | undefined>;
}

const num = (value: unknown): number => {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** The values a variable holds now, as a list: empty, All and blank values dropped. */
export function pickedValues(value: ValueOf, variable: string): string[] {
  const raw = value(variable);
  const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((v) => String(v).trim());
  return list.includes('$__all') ? [] : list.filter((v) => v !== '');
}

/** A range filter's ends as numbers (epoch milliseconds for times); undefined ends are open. */
export function rangeOf(filter: RangeFilter, value: ValueOf): [number | undefined, number | undefined] {
  const parse = filter.as === 'time' ? parseTime : parseNumber;
  return [parse(pickedValues(value, filter.from)[0] ?? ''), parse(pickedValues(value, filter.to)[0] ?? '')];
}

/** Extents by table, column and type: a dataset's extent changes only when it reloads into a new table. */
export type ExtentCache = Map<string, { lo: number; hi: number } | undefined>;

export async function loadPanelData(
  run: Run,
  dataset: DeclaredDataset,
  states: Clause[],
  value: ValueOf,
  time: string[],
  limits: { maxValues: number; bins: number },
  extents: ExtentCache
): Promise<PanelData> {
  const { table, filters } = dataset;
  const valueFilters = filters.filter(
    (f): f is Extract<FilterDeclaration, { type: 'in' | 'equals' }> => f.type === 'in' || f.type === 'equals'
  );
  const rangeFilters = filters.filter((f): f is RangeFilter => f.type === 'range');

  const extentOf = async (f: RangeFilter) => {
    const key = `${table}\u0000${f.column}\u0000${f.as ?? 'number'}`;
    if (!extents.has(key)) {
      const [row] = await run(extentSql(table, f.column, f.as === 'time'));
      const lo = row?.lo;
      const hi = row?.hi;
      extents.set(key, lo === null || hi === null || lo === undefined ? undefined : { lo: num(lo), hi: num(hi) });
    }
    return extents.get(key);
  };

  const [countRows, valueLists, histograms] = await Promise.all([
    run(countSql(table, states, time)),
    Promise.all(
      valueFilters.map(async (f) => {
        const rows = await run(
          valuesSql(table, f.column, states, f.name, time, pickedValues(value, f.variable), limits.maxValues * 25)
        );
        return [f.name, rows.map((r) => ({ value: String(r.value), n: num(r.n), total: num(r.total) }))] as const;
      })
    ),
    Promise.all(
      rangeFilters.map(async (f) => {
        const extent = await extentOf(f);
        if (!extent) {
          return [f.name, undefined] as const;
        }
        const rows = await run(
          histogramSql(table, f.column, f.as === 'time', extent, limits.bins, states, f.name, time)
        );
        const n = new Array<number>(limits.bins).fill(0);
        const total = new Array<number>(limits.bins).fill(0);
        for (const r of rows) {
          const i = num(r.bin);
          if (i >= 0 && i < limits.bins) {
            n[i] = num(r.n);
            total[i] = num(r.total);
          }
        }
        return [f.name, { extent, n, total }] as const;
      })
    ),
  ]);

  const counts = countRows[0] ?? {};
  const without: Record<string, number> = {};
  for (const s of states) {
    if (s.sql !== undefined) {
      without[s.name] = num(counts[`without_${s.name}`]);
    }
  }
  return {
    dataset,
    states,
    total: num(counts.total),
    shown: num(counts.shown),
    without,
    values: Object.fromEntries(valueLists),
    histograms: Object.fromEntries(histograms),
  };
}
