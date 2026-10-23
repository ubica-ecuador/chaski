import { locationService } from '@grafana/runtime';
import { isSelection, type Param, type Selection, type SelectionClause } from '@uwdata/mosaic-core';
import { and, column, gte, isBetween, isIn, literal, lte, sql, type ExprNode } from '@uwdata/mosaic-sql';
import { parse as parseYaml } from 'yaml';

/*
 * From Grafana to Mosaic: dashboard variables written elsewhere (a kepler
 * map's viewport or drawn area, a variable picker) become clauses of a
 * Selection, so the Mosaic panels follow them. Read from the URL, as kepler
 * does: the template service lags behind a write.
 */

export interface VariableRead {
  /** A Selection of the spec that takes the clause. */
  param: string;
  /** The column filtered; for `area`, the longitude and latitude columns. */
  column: string | string[];
  /** A range, from one or two variables; an empty end is open. */
  from?: string;
  to?: string;
  /** A WKT polygon in longitude and latitude, as kepler's drawn area writes it. */
  area?: string;
  /** The values to keep, from a (multi-value) variable. */
  values?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The reads, written as YAML or JSON (a list). Throws with a message for the panel. */
export function parseReads(text: string | undefined, written: Set<string> = new Set()): VariableRead[] {
  const source = (text ?? '').trim();
  if (source === '') {
    return [];
  }
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new Error(`Read from variables does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) {
    throw new Error('Read from variables must be a list, one entry per clause.');
  }
  return value.map((entry, i) => {
    const where = `Read from variables, entry ${i + 1}`;
    if (!isObject(entry) || typeof entry.param !== 'string') {
      throw new Error(`${where}: \`param\` names a Selection of the spec.`);
    }
    const columns = [entry.column].flat();
    if (columns.length === 0 || !columns.every((c) => typeof c === 'string' && c !== '')) {
      throw new Error(`${where}: \`column\` names the column it filters.`);
    }
    if (typeof entry.area === 'string' && columns.length !== 2) {
      throw new Error(`${where}: an area filters two columns, \`[longitude, latitude]\`.`);
    }
    const names = ['from', 'to', 'area', 'values']
      .map((k) => entry[k])
      .filter((v): v is string => typeof v === 'string');
    if (names.length === 0) {
      throw new Error(`${where}: give \`from\` and \`to\`, \`area\` or \`values\`.`);
    }
    // A panel reading what it writes would chase its own brush.
    const own = names.find((name) => written.has(name));
    if (own) {
      throw new Error(`${where}: this panel writes \`${own}\`; read only what other panels write.`);
    }
    return entry as unknown as VariableRead;
  });
}

/** A variable's value as the URL holds it: one string, several, or none. */
export type ReadValue = (variable: string) => string[];

export const readFromUrl: ReadValue = (variable) =>
  locationService
    .getSearch()
    .getAll(`var-${variable}`)
    .filter((v) => v !== '' && v !== '$__all');

/** A number or a time from a variable's text, as Mosaic's literals take it. */
function scalar(text: string | undefined): number | Date | undefined {
  if (text === undefined || text.trim() === '') {
    return undefined;
  }
  const n = Number(text);
  if (Number.isFinite(n)) {
    return n;
  }
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** The longitude and latitude pairs of a WKT polygon's outer ring, or nothing if it is not one. */
export function wktRing(wkt: string): Array<[number, number]> {
  if (!/^\s*(MULTI)?POLYGON\s*\(/i.test(wkt)) {
    return [];
  }
  const numbers = (wkt.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    ring.push([numbers[i], numbers[i + 1]]);
  }
  return ring.length >= 3 ? ring : [];
}

/**
 * Rows whose longitude and latitude fall in a WKT polygon, as kepler's drawn
 * area writes it: its bounding box first, which DuckDB answers cheaply, then
 * the polygon. Null when the text is no polygon. The polygon is rebuilt from
 * its numbers, so nothing else of the text reaches the SQL.
 */
export function areaPredicate(
  lngColumn: string,
  latColumn: string,
  wkt: string
): { value: string; predicate: ExprNode } | null {
  const ring = wktRing(wkt);
  if (ring.length === 0) {
    return null;
  }
  const polygon = `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`;
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const lng = column(lngColumn);
  const lat = column(latColumn);
  return {
    value: polygon,
    predicate: and(
      isBetween(lng, [Math.min(...xs), Math.max(...xs)]),
      isBetween(lat, [Math.min(...ys), Math.max(...ys)]),
      sql`ST_Contains(ST_GeomFromText(${literal(polygon)}), ST_Point(${lng}, ${lat}))`
    ),
  };
}

/** The predicate a read makes of the variables' current values, or null when they say nothing. */
export function predicateFor(read: VariableRead, valueOf: ReadValue): { value: unknown; predicate: ExprNode } | null {
  const [first, second] = [read.column].flat();
  if (read.area !== undefined) {
    const [wkt] = valueOf(read.area);
    return wkt ? areaPredicate(first, second, wkt) : null;
  }
  if (read.values !== undefined) {
    const values = valueOf(read.values);
    return values.length > 0
      ? {
          value: values,
          predicate: isIn(
            column(first),
            values.map((v) => literal(v))
          ),
        }
      : null;
  }
  const lo = scalar(read.from ? valueOf(read.from)[0] : undefined);
  const hi = scalar(read.to ? valueOf(read.to)[0] : undefined);
  const field = column(first);
  if (lo !== undefined && hi !== undefined) {
    return { value: [lo, hi], predicate: isBetween(field, [lo, hi]) };
  }
  if (lo !== undefined) {
    return { value: [lo, undefined], predicate: gte(field, lo) };
  }
  if (hi !== undefined) {
    return { value: [undefined, hi], predicate: lte(field, hi) };
  }
  return null;
}

/** The variables a read depends on. */
const variablesOf = (read: VariableRead) =>
  [read.from, read.to, read.area, read.values].filter((v): v is string => !!v);

/**
 * Keeps one clause per read in its Selection, in step with the variables: set
 * when they say something, removed when they are emptied. Starts from what the
 * URL holds, and follows every change to it. Returns the function that stops
 * it and takes its clauses back out.
 */
export function linkReads(
  reads: VariableRead[],
  params: Map<string, Param<unknown> | Selection>,
  valueOf: ReadValue = readFromUrl,
  listen: (onChange: () => void) => () => void = (onChange) => locationService.getHistory().listen(onChange)
): () => void {
  const live = reads
    .map((read) => ({ read, selection: params.get(read.param), source: { read }, last: '' }))
    .filter((r): r is typeof r & { selection: Selection } => r.selection !== undefined && isSelection(r.selection));
  if (live.length === 0) {
    return () => {};
  }
  const apply = () => {
    for (const r of live) {
      const key = JSON.stringify(variablesOf(r.read).map(valueOf));
      if (key === r.last) {
        continue;
      }
      r.last = key;
      const made = predicateFor(r.read, valueOf);
      const fields = [r.read.column].flat().map((c) => column(c));
      const clause: SelectionClause = {
        source: r.source,
        clients: new Set(),
        fields,
        value: made?.value ?? null,
        predicate: made?.predicate ?? null,
        meta: { type: 'variable' },
      };
      r.selection.update(clause);
    }
  };
  apply();
  const unlisten = listen(apply);
  return () => {
    unlisten();
    for (const r of live) {
      const own = r.selection.clauses.filter((c) => c.source === r.source);
      if (own.length > 0) {
        r.selection.reset(own);
      }
    }
  };
}
