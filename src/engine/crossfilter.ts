import { quoteIdent, quoteLiteral, shortHash } from './sql';

/**
 * Cross-filters: a filters variable declares them for one dataset, and the
 * `$__crossfilter` and `$__filters` macros turn them into SQL.
 *
 * A filter is a column and the dashboard variables that narrow it. Panels
 * write those variables (a brush, a map's drawn area, a picked value) and
 * every other panel reads them; the panel that writes a filter leaves it out
 * of its own query, or it would narrow itself and could never widen again.
 * The model is heavyai-crossfilter's: each query applies every active filter
 * but its own.
 *
 * Grafana re-runs a panel only when a variable its query names changes, so the
 * declarations live in a variable of their own. They name the variables they
 * read as `$name`, which makes Grafana refresh the filters variable whenever
 * one of them changes; its value (`dataset#hash`) changes with the filters'
 * state, and every panel naming it in `$__crossfilter($quakeFilters)` runs
 * again.
 *
 * Variable values never reach the SQL as text: numbers and times are parsed
 * here and printed back, strings go through quoteLiteral and columns through
 * quoteIdent. An empty or unreadable value turns its filter (or its end of a
 * range) off, as `try_cast` did in the hand-written queries this replaces.
 */

interface Named {
  /** What `-name` in `$__crossfilter` excludes; unique within the dataset. */
  name: string;
  /** What the filter bar calls it; the name when absent. */
  label?: string;
}

/** `column >= from AND column < to`; either end may be empty. */
export interface RangeFilter extends Named {
  type: 'range';
  column: string;
  from: string;
  to: string;
  /** How the variables read: numbers (the default) or times (ISO 8601, or epoch milliseconds). */
  as?: 'number' | 'time';
  /** `open` (the default) leaves the upper end out, `closed` keeps it. */
  upper?: 'open' | 'closed';
}

/** `column IN (…)` over a multi-value variable; empty or All is no filter. */
export interface InFilter extends Named {
  type: 'in';
  column: string;
  variable: string;
}

export interface EqualsFilter extends Named {
  type: 'equals';
  column: string;
  variable: string;
}

/** Case-insensitive substring match, for a text box. */
export interface SearchFilter extends Named {
  type: 'search';
  column: string;
  variable: string;
}

/** A drawn polygon or rectangle, as WKT in EPSG:4326, over latitude and longitude columns. */
export interface AreaFilter extends Named {
  type: 'area';
  variable: string;
  lat: string;
  lng: string;
}

/**
 * Rows whose `column` is among another dataset's `to` values under that dataset's active filters: a cohort.
 * Declared with `filters: "$otherFilters"`, that dataset's filters variable; held here by its dataset's name.
 */
export interface LinkFilter extends Named {
  type: 'link';
  column: string;
  dataset: string;
  to: string;
}

/** A filter as the macros use it: variables by plain name, a link by its dataset. */
export type FilterDeclaration = RangeFilter | InFilter | EqualsFilter | SearchFilter | AreaFilter | LinkFilter;

/** A dataset with the table its panels read now and the filters declared for it. */
export interface DeclaredDataset {
  name: string;
  table: string;
  filters: FilterDeclaration[];
}

/** What the macros need from the dashboard. */
export interface CrossfilterSource {
  /** A dataset by name, with its declared filters, or undefined when none is loaded or declared. */
  dataset(name: string): DeclaredDataset | undefined;
  /** A variable's raw value, a list for a multi-value one; undefined when the dashboard has no such variable. */
  value(variable: string): string | string[] | undefined;
}

/** One declared filter as it stands now. */
interface Clause {
  name: string;
  label: string;
  /** The condition, or undefined while the filter is off. */
  sql?: string;
  /** The value as the filter bar shows it; empty while off. */
  text: string;
  /** The variables that clear it. */
  variables: string[];
}

/** The keys each type must have: column names, and variables written `$name`. */
const REQUIRED: Record<FilterDeclaration['type'], { columns: string[]; variables: string[] }> = {
  range: { columns: ['column'], variables: ['from', 'to'] },
  in: { columns: ['column'], variables: ['variable'] },
  equals: { columns: ['column'], variables: ['variable'] },
  search: { columns: ['column'], variables: ['variable'] },
  area: { columns: ['lat', 'lng'], variables: ['variable'] },
  link: { columns: ['column', 'to'], variables: ['filters'] },
};

/** `$name` or `${name}` → name; anything else is not a reference Grafana would follow. */
function variableName(reference: string): string | undefined {
  const match = /^\$(?:\{(\w+)\}|(\w+))$/.exec(reference.trim());
  return match ? (match[1] ?? match[2]) : undefined;
}

/** `quakes#1a2b3c4d` → quakes: the value of a filters variable. */
function datasetOfValue(value: string): string | undefined {
  const match = /^(.+)#[0-9a-f]{8}$/.exec(value);
  return match ? match[1] : undefined;
}

/**
 * The declarations of a filters variable as written in the dashboard, checked, with each `$name` read as the
 * variable's name and each link's filters variable read as its dataset.
 */
export function normalizeFilters(
  dataset: string,
  authored: unknown,
  value: CrossfilterSource['value']
): FilterDeclaration[] {
  if (!Array.isArray(authored)) {
    throw new Error(`The filters variable of dataset ${dataset} needs a list of filters`);
  }
  const seen = new Set<string>();
  return authored.map((item: unknown): FilterDeclaration => {
    const filter = (item ?? {}) as Record<string, unknown>;
    const name = typeof filter.name === 'string' ? filter.name.trim() : '';
    if (!/^[\w-]+$/.test(name)) {
      throw new Error(`A filter of dataset ${dataset} needs a name of letters, digits, _ or -`);
    }
    if (seen.has(name)) {
      throw new Error(`Dataset ${dataset} declares the filter ${name} twice`);
    }
    seen.add(name);
    const type = filter.type as FilterDeclaration['type'];
    if (typeof type !== 'string' || !(type in REQUIRED)) {
      throw new Error(`Filter ${name} of dataset ${dataset} has an unknown type: ${String(filter.type)}`);
    }
    const out: Record<string, unknown> = { ...filter, name };
    const { columns, variables } = REQUIRED[type];
    for (const key of [...columns, ...variables]) {
      if (typeof filter[key] !== 'string' || (filter[key] as string).trim() === '') {
        throw new Error(`Filter ${name} of dataset ${dataset} needs ${key}`);
      }
    }
    for (const key of variables) {
      const variable = variableName(filter[key] as string);
      if (!variable) {
        throw new Error(
          `Filter ${name} of dataset ${dataset} must name its variable as $${String(filter[key]).replace(/^\$/, '')}` +
            ', so Grafana refreshes the filters when it changes'
        );
      }
      out[key] = variable;
    }
    if (type === 'link') {
      const linked = value(out.filters as string);
      const other = typeof linked === 'string' ? datasetOfValue(linked) : undefined;
      if (!other) {
        throw new Error(
          `Filter ${name} of dataset ${dataset} links to ${String(filter.filters)}, which is not a filters variable`
        );
      }
      delete out.filters;
      out.dataset = other;
    }
    return out as unknown as FilterDeclaration;
  });
}

function resolve(source: CrossfilterSource, name: string): DeclaredDataset {
  const dataset = source.dataset(name);
  if (!dataset) {
    throw new Error(`No filters are declared for a dataset ${name} on this dashboard`);
  }
  return dataset;
}

/** The raw value, failing loudly for a variable the dashboard lacks: a typo would otherwise filter nothing. */
function read(source: CrossfilterSource, dataset: DeclaredDataset, filter: Named, variable: string): string[] {
  const value = source.value(variable);
  if (value === undefined) {
    throw new Error(
      `Filter ${filter.name} of dataset ${dataset.name} reads the variable ${variable}, which this dashboard does not have`
    );
  }
  const values = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim());
  return values.includes('$__all') ? [] : values.filter((v) => v !== '');
}

function single(source: CrossfilterSource, dataset: DeclaredDataset, filter: Named, variable: string): string {
  return read(source, dataset, filter, variable)[0] ?? '';
}

function parseNumber(text: string): number | undefined {
  if (text === '') {
    return undefined;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Epoch milliseconds, or ISO 8601. A date and time with no zone is UTC, as DuckDB reads it here; JavaScript
 * alone would read it in the viewer's own zone.
 */
function parseTime(text: string): number | undefined {
  if (text === '') {
    return undefined;
  }
  const zoneless = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(text);
  const ms = /^-?\d+$/.test(text) ? Number(text) : Date.parse(zoneless ? `${zoneless[1]}T${zoneless[2]}Z` : text);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * A time as an ISO 8601 string in UTC, as $__timeFilter writes it: DuckDB casts it to the column's own type.
 * A TIMESTAMPTZ literal would not compare with a TIMESTAMP_MS column without ICU, which Chaski does not load.
 */
const timeLiteral = (ms: number): string => quoteLiteral(new Date(ms).toISOString());

/** `2026-10-01` at midnight UTC, `2026-10-01 14:30` otherwise. */
function timeText(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const column = (name: string, alias?: string): string => (alias ? `${quoteIdent(alias)}.` : '') + quoteIdent(name);

function rangeClause(f: RangeFilter, dataset: DeclaredDataset, source: CrossfilterSource, alias?: string): Clause {
  const asTime = f.as === 'time';
  const parse = asTime ? parseTime : parseNumber;
  const lo = parse(single(source, dataset, f, f.from));
  const hi = parse(single(source, dataset, f, f.to));
  const literal = (v: number) => (asTime ? timeLiteral(v) : String(v));
  const show = (v: number) => (asTime ? timeText(v) : String(v));
  const col = column(f.column, alias);
  const closed = f.upper === 'closed';
  const parts: string[] = [];
  if (lo !== undefined) {
    parts.push(`${col} >= ${literal(lo)}`);
  }
  if (hi !== undefined) {
    parts.push(`${col} ${closed ? '<=' : '<'} ${literal(hi)}`);
  }
  const text =
    lo !== undefined && hi !== undefined
      ? `${show(lo)} – ${show(hi)}`
      : lo !== undefined
        ? `≥ ${show(lo)}`
        : hi !== undefined
          ? `${closed ? '≤' : '<'} ${show(hi)}`
          : '';
  return {
    name: f.name,
    label: f.label ?? f.name,
    sql: parts.length ? parts.join(' AND ') : undefined,
    text,
    variables: [f.from, f.to],
  };
}

/** Every number in the WKT, as (longitude, latitude) pairs: Kepler writes one ring, POLYGON((x y, …)). */
function ringOf(wkt: string): Array<[number, number]> {
  const numbers = (wkt.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const ring: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    ring.push([numbers[i], numbers[i + 1]]);
  }
  if (ring.length < 3) {
    return [];
  }
  // A ring drawn across the antimeridian keeps going past ±180; shift it so its centre is in range, as the
  // area-filter.sql template did.
  const mean = ring.reduce((sum, [x]) => sum + x, 0) / ring.length;
  const shift = 360 * Math.round(mean / 360);
  return ring.map(([x, y]) => [x - shift, y]);
}

/**
 * Point in polygon by ray casting, one term per edge with the coordinates as literals, behind a bounding box
 * that skips most rows cheaply. No `spatial` extension: Chaski loads only the core.
 */
function areaSql(ring: Array<[number, number]>, lat: string, lng: string): string {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const box = `${lat} BETWEEN ${Math.min(...ys)} AND ${Math.max(...ys)} AND ${lng} BETWEEN ${Math.min(...xs)} AND ${Math.max(...xs)}`;
  const terms: string[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    if (y1 === y2) {
      continue;
    }
    terms.push(
      `CASE WHEN (${y1} > ${lat}) <> (${y2} > ${lat}) AND ${lng} < ${x2 - x1} * (${lat} - ${y1}) / ${y2 - y1} + ${x1} THEN 1 ELSE 0 END`
    );
  }
  return terms.length ? `(${box} AND (${terms.join(' + ')}) % 2 = 1)` : 'FALSE';
}

function clausesOf(
  dataset: DeclaredDataset,
  source: CrossfilterSource,
  alias: string | undefined,
  visiting: Set<string>
): Clause[] {
  if (visiting.has(dataset.name)) {
    throw new Error(`The link filters of dataset ${dataset.name} lead back to it`);
  }
  const path = new Set(visiting).add(dataset.name);
  return dataset.filters.map((f): Clause => {
    const label = f.label ?? f.name;
    switch (f.type) {
      case 'range':
        return rangeClause(f, dataset, source, alias);
      case 'in': {
        const values = read(source, dataset, f, f.variable);
        const text = values.length > 3 ? `${values.length} values` : values.join(', ');
        const sql = values.length
          ? `${column(f.column, alias)} IN (${values.map(quoteLiteral).join(', ')})`
          : undefined;
        return { name: f.name, label, sql, text, variables: [f.variable] };
      }
      case 'equals': {
        const value = single(source, dataset, f, f.variable);
        const sql = value !== '' ? `${column(f.column, alias)} = ${quoteLiteral(value)}` : undefined;
        return { name: f.name, label, sql, text: value, variables: [f.variable] };
      }
      case 'search': {
        const value = single(source, dataset, f, f.variable);
        const sql =
          value !== ''
            ? `contains(lower(CAST(${column(f.column, alias)} AS VARCHAR)), ${quoteLiteral(value.toLowerCase())})`
            : undefined;
        return { name: f.name, label, sql, text: value ? `“${value}”` : '', variables: [f.variable] };
      }
      case 'area': {
        const ring = ringOf(single(source, dataset, f, f.variable));
        const sql = ring.length ? areaSql(ring, column(f.lat, alias), column(f.lng, alias)) : undefined;
        return { name: f.name, label, sql, text: ring.length ? 'drawn area' : '', variables: [f.variable] };
      }
      case 'link': {
        const other = resolve(source, f.dataset);
        const active = clausesOf(other, source, undefined, path).filter((c) => c.sql !== undefined);
        const sql = active.length
          ? `${column(f.column, alias)} IN (SELECT ${quoteIdent(f.to)} FROM ${quoteIdent(other.table)} WHERE ${active
              .map((c) => c.sql)
              .join(' AND ')})`
          : undefined;
        const text = active.length ? `as filtered in ${other.name}` : '';
        return { name: f.name, label, sql, text, variables: [] };
      }
    }
  });
}

/**
 * The value of a dataset's filters variable: its name and a hash of every filter's condition, so it changes,
 * and the panels naming it run again, whenever one of the filters does.
 */
export function filtersValue(dataset: DeclaredDataset, source: CrossfilterSource): string {
  const state = clausesOf(dataset, source, undefined, new Set()).map((c) => c.sql ?? '');
  return `${dataset.name}#${shortHash(JSON.stringify(state))}`;
}

/** The first macro argument: a filters variable as it interpolated (`'quakes#1a2b3c4d'`), with an optional alias. */
function parseFiltersArg(macro: string, arg: string): { name: string; alias?: string } {
  const match = /^\s*'((?:[^']|'')*)'(?:\s+AS\s+([A-Za-z_]\w*))?\s*$/i.exec(arg);
  const name = match ? datasetOfValue(match[1].replace(/''/g, "'")) : undefined;
  if (!match || !name) {
    throw new Error(
      `$__${macro} takes a filters variable, such as $quakeFilters, received ${arg.trim() || 'nothing'}: ` +
        'Grafana runs a panel again only when a variable its query names changes'
    );
  }
  return { name, alias: match[2] };
}

/**
 * `$__crossfilter($filters[ AS alias], -name, …)`: the AND of the dataset's active filters, leaving out each
 * `-name`. Always a parenthesised boolean, `(TRUE)` when nothing is active, so it fits any WHERE.
 */
export function crossfilterSql(args: string[], source: CrossfilterSource): string {
  if (args.length === 0) {
    throw new Error('$__crossfilter expects a filters variable, then any filters to leave out as -name');
  }
  const { name, alias } = parseFiltersArg('crossfilter', args[0]);
  const dataset = resolve(source, name);
  const names = new Set(dataset.filters.map((f) => f.name));
  const except = new Set<string>();
  for (const arg of args.slice(1)) {
    const match = /^\s*-\s*([\w-]+)\s*$/.exec(arg);
    if (!match) {
      throw new Error(`$__crossfilter leaves filters out as -name, received ${arg}`);
    }
    if (!names.has(match[1])) {
      throw new Error(
        `Dataset ${dataset.name} declares no filter ${match[1]}; it has ${[...names].join(', ') || 'none'}`
      );
    }
    except.add(match[1]);
  }
  const active = clausesOf(dataset, source, alias, new Set())
    .filter((c) => !except.has(c.name) && c.sql !== undefined)
    .map((c) => c.sql);
  return `(${['TRUE', ...active].join(' AND ')})`;
}

/**
 * `$__filters($filters)`: a table of the dataset's declared filters, one row each, for a filter bar:
 * name, label, active, value (as a reader would write it) and variables (the ones that clear it, comma-separated).
 */
export function filtersSql(args: string[], source: CrossfilterSource): string {
  if (args.length !== 1) {
    throw new Error(`$__filters expects 1 argument, received ${args.length}`);
  }
  const { name } = parseFiltersArg('filters', args[0]);
  const clauses = clausesOf(resolve(source, name), source, undefined, new Set());
  const columns = '(name, label, active, value, variables)';
  if (clauses.length === 0) {
    return `(SELECT * FROM (VALUES ('', '', FALSE, '', '')) AS f${columns} WHERE FALSE)`;
  }
  const rows = clauses.map(
    (c) =>
      `(${quoteLiteral(c.name)}, ${quoteLiteral(c.label)}, ${c.sql !== undefined ? 'TRUE' : 'FALSE'}, ${quoteLiteral(
        c.text
      )}, ${quoteLiteral(c.variables.join(','))})`
  );
  return `(SELECT * FROM (VALUES ${rows.join(', ')}) AS f${columns})`;
}
