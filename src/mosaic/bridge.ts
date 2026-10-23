import { locationService } from '@grafana/runtime';
import { isSelection, type Param, type Selection, type SelectionClause } from '@uwdata/mosaic-core';
import { collectColumns } from '@uwdata/mosaic-sql';
import { parse as parseYaml } from 'yaml';

/*
 * From Mosaic to Grafana: a Selection or Param named in the spec writes
 * dashboard variables, so panels on other datasources (a kepler map, a chart
 * reading Chaski's $__crossfilter) follow a brush made here. One way only.
 */

export interface VariableLink {
  /** A Selection or Param from the spec's `params`. */
  param: string;
  /**
   * For a Selection, whose clause to read: the one over this column, or over
   * these two for a 2-D brush. Without it, the most recent clause.
   */
  column?: string | string[];
  /**
   * An interval's ends; for a 2-D brush, one variable per axis, in the
   * order of `column`.
   */
  from?: string | string[];
  to?: string | string[];
  /**
   * Anything else: the points or text picked, a Param's value, or a 2-D
   * brush as a WKT polygon. The polygon is for longitude and latitude, which
   * Chaski's `area` filter reads as such (it wraps them at the antimeridian);
   * other axes take `from` and `to`.
   */
  variable?: string;
  /** Rounds an interval's end before it is written; a brush's ends come from pixels. */
  round?: (value: unknown) => unknown;
}

export type Writes = Record<string, string | string[]>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The links, written as YAML or JSON (a list). Throws with a message for the panel. */
export function parseLinks(text: string | undefined): VariableLink[] {
  const source = (text ?? '').trim();
  if (source === '') {
    return [];
  }
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new Error(`Variables do not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(value)) {
    throw new Error('Variables must be a list, one entry per param.');
  }
  return value.map((entry, i) => {
    if (!isObject(entry) || typeof entry.param !== 'string') {
      throw new Error(`Variables, entry ${i + 1}: \`param\` names a Selection or Param of the spec.`);
    }
    const isNames = (v: unknown) =>
      typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'string'));
    const names = ['from', 'to', 'variable'].filter((key) => isNames(entry[key]));
    if (names.length === 0) {
      throw new Error(`Variables, entry ${i + 1}: give \`from\` and \`to\`, or \`variable\`.`);
    }
    return entry as unknown as VariableLink;
  });
}

/**
 * A value as a variable holds it: times as UTC ISO, numbers to 12 significant
 * digits. A brush's ends come from pixels, so binary noise such as
 * 7.700000000000001 says nothing; twelve digits drop it and change no filter.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Number(value.toPrecision(12)));
  }
  return String(value);
}

/** The column names a clause filters on, in field order. */
export function clauseColumns(clause: SelectionClause): string[] {
  return clause.fields.map((field) => collectColumns(field)[0]?.column ?? String(field));
}

function pickClause(selection: Selection, column: VariableLink['column']): SelectionClause | undefined {
  // A clause read from a variable (inbound.ts) is that variable's, not this panel's to write back.
  const clauses = selection.clauses.filter((c) => (c.meta as { type?: string } | undefined)?.type !== 'variable');
  if (column === undefined) {
    return selection.active && clauses.includes(selection.active) ? selection.active : clauses[clauses.length - 1];
  }
  const wanted = Array.isArray(column) ? column : [column];
  return clauses.find((clause) => {
    const columns = clauseColumns(clause);
    return columns.length === wanted.length && wanted.every((name, i) => columns[i] === name);
  });
}

/** A 2-D extent, `[[x0, x1], [y0, y1]]`, as the closed WKT polygon kepler and Chaski's `area` filter use. */
export function extentToWkt([[x0, x1], [y0, y1]]: [[number, number], [number, number]]): string {
  const ring = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`;
}

function clauseWrites(link: VariableLink, clause: SelectionClause | undefined, writes: Writes) {
  const value = clause?.value;
  const type = (clause?.meta as { type?: string } | undefined)?.type;
  if (link.from !== undefined || link.to !== undefined) {
    // One [lo, hi] per axis: a 1-D interval's value is that pair, a 2-D one's a pair of them.
    const interval = type === 'interval' && Array.isArray(value);
    const extents: unknown[][] = !interval ? [] : clause!.fields.length === 1 ? [value] : (value as unknown[][]);
    const ends = (names: string | string[] | undefined, end: 0 | 1) =>
      [names ?? []].flat().forEach((name, axis) => {
        const bound = extents[axis]?.[end];
        writes[name] = formatValue(link.round && bound !== undefined ? link.round(bound) : bound);
      });
    ends(link.from, 0);
    ends(link.to, 1);
  }
  if (link.variable === undefined) {
    return;
  }
  if (value === undefined || value === null) {
    writes[link.variable] = '';
  } else if (type === 'interval' && clause!.fields.length === 2 && Array.isArray(value)) {
    writes[link.variable] = extentToWkt(value as [[number, number], [number, number]]);
  } else if (Array.isArray(value)) {
    // Points: each one a value, or a tuple when the clause spans several fields.
    writes[link.variable] = value.map((point) =>
      Array.isArray(point) ? point.map(formatValue).join(',') : formatValue(point)
    );
  } else {
    writes[link.variable] = formatValue(value);
  }
}

/** What the links write for the params' current state. */
export function writesFor(links: VariableLink[], params: Map<string, Param<unknown> | Selection>): Writes {
  const writes: Writes = {};
  for (const link of links) {
    const param = params.get(link.param);
    if (!param) {
      continue;
    }
    if (isSelection(param)) {
      clauseWrites(link, pickClause(param, link.column), writes);
    } else if (link.variable !== undefined) {
      const value = param.value;
      writes[link.variable] = Array.isArray(value) ? value.map(formatValue) : formatValue(value);
    }
  }
  return writes;
}

/** How long a brush rests before its variables are written; each write runs every panel that reads them. */
export const PUBLISH_DELAY_MS = 300;

const sameValue = (a: string | string[] | undefined, b: string | string[]) =>
  JSON.stringify(a ?? '') === JSON.stringify(b);

/**
 * Writes the variables whenever a linked param changes, once it rests. Only
 * changes are written, and nothing on start: the variables keep whatever the
 * URL or another panel put there until this panel's params move.
 *
 * The returned function stops it. With `flush`, a write still waiting goes out
 * first: a panel rebuilt on the same dashboard has just cleared its brushes,
 * and the variables must say so. Without it the write is dropped, as when the
 * dashboard is left: the URL is already another dashboard's.
 */
export function linkVariables(
  links: VariableLink[],
  params: Map<string, Param<unknown> | Selection>
): (flush?: boolean) => void {
  if (links.length === 0) {
    return () => {};
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = writesFor(links, params);
  const publish = () => {
    timer = undefined;
    const next = writesFor(links, params);
    const changed: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(next)) {
      if (!sameValue(last[name], value)) {
        changed[`var-${name}`] = value;
      }
    }
    last = next;
    if (Object.keys(changed).length > 0) {
      locationService.partial(changed, true);
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(publish, PUBLISH_DELAY_MS);
  };
  const watched = new Set(
    links.map((link) => params.get(link.param)).filter((p): p is Param<unknown> => p !== undefined)
  );
  watched.forEach((param) => param.addEventListener('value', schedule));
  return (flush = false) => {
    watched.forEach((param) => param.removeEventListener('value', schedule));
    if (timer !== undefined) {
      clearTimeout(timer);
      if (flush) {
        publish();
      }
    }
  };
}
