import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import { column, literal, sql } from '@uwdata/mosaic-sql';

import { clauseColumns, clausesNow } from '../mosaic/bridge';
import { isHolder } from '../mosaic/page';

/*
 * From the URL to the controls. The panel's controls write their variables
 * through the bridge; anything else that sets them (a shared link, a chip's ×,
 * Clear all, another panel) is applied to the control here, so its brush or
 * picks show it and the other controls count under it. A value the control
 * already holds, within a pixel, is left alone: that is its own write coming
 * back.
 */

/** What the panel needs of Mosaic's Interval1D interactor. */
export interface IntervalInteractor {
  value?: unknown[];
  /** The mark the brush sits on: the grey layer of a histogram. */
  mark?: unknown;
  scale?: {
    type?: string;
    domain?: unknown[];
    range?: number[];
    apply(value: unknown): number;
    invert?(pixel: number): unknown;
  };
  g?: { call(fn: unknown, extent: unknown): unknown };
  brush: { moveSilent: unknown };
  selection: Selection;
  reset(): void;
  clause(value: unknown): SelectionClause;
}

/** What the panel needs of Mosaic's Toggle interactor. */
export interface ToggleInteractor {
  value: unknown[][] | null;
  selection: Selection;
  clause(value: unknown): SelectionClause;
}

const asNumber = (value: unknown): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Number(value);

const isTimeScale = (scale: IntervalInteractor['scale']) => scale?.type === 'time' || scale?.type === 'utc';

/** One pixel of the interactor's axis, in its units; 0 when it has not drawn yet. */
export function pixelOf(interactor: IntervalInteractor): number {
  const domain = interactor.scale?.domain?.map(asNumber) ?? [];
  const range = interactor.scale?.range ?? [];
  if (domain.length < 2 || range.length < 2) {
    return 0;
  }
  return Math.abs(domain[1] - domain[0]) / Math.max(1, Math.abs(range[1] - range[0]));
}

/**
 * Sets an interval control to the URL's range, or clears it. Open ends take
 * the axis's ends. Returns whether it changed anything.
 */
export function applyRange(interactor: IntervalInteractor, range: [number | undefined, number | undefined]): boolean {
  const [lo, hi] = range;
  const held = interactor.value?.map(asNumber);
  if (lo === undefined && hi === undefined) {
    if (!held) {
      return false;
    }
    interactor.reset();
    interactor.selection.update(interactor.clause(undefined));
    return true;
  }
  const domain = interactor.scale?.domain?.map(asNumber) ?? [];
  const ends = [lo ?? Math.min(...domain), hi ?? Math.max(...domain)];
  if (!ends.every(Number.isFinite)) {
    return false;
  }
  const pixel = pixelOf(interactor);
  if (
    held &&
    held.length === 2 &&
    held.every((v, i) => Math.abs(v - ends[i]) <= Math.max(pixel, toleranceOf(0, ends[i])))
  ) {
    return false;
  }
  const value = isTimeScale(interactor.scale) ? ends.map((v) => new Date(v)) : ends;
  interactor.value = value;
  if (interactor.g && interactor.scale) {
    const extent = value.map((v) => interactor.scale!.apply(v)).sort((a, b) => a - b);
    interactor.g.call(interactor.brush.moveSilent, extent);
  }
  interactor.selection.update(interactor.clause(value));
  return true;
}

/** Sets a value control's picks, in its own Selection and in the one that highlights them. */
export function applyValues(interactors: ToggleInteractor[], values: string[]): boolean {
  const held = (interactors[0]?.value ?? []).map((point) => String(point[0]));
  const same = held.length === values.length && held.every((v) => values.includes(v));
  if (same) {
    return false;
  }
  const points = values.length ? values.map((v) => [v]) : null;
  for (const interactor of interactors) {
    interactor.value = points;
    interactor.selection.update(interactor.clause(points));
  }
  return true;
}

/**
 * A search's clause: a case-insensitive substring, as Chaski's `search`
 * filter reads it, so the controls count what the dashboard's SQL shows.
 */
export function searchClause(source: object, columnName: string, text: string): SelectionClause {
  const field = column(columnName);
  const needle = text.trim();
  return {
    source,
    clients: new Set(),
    fields: [field],
    value: needle || null,
    predicate: needle ? sql`contains(lower(CAST(${field} AS VARCHAR)), ${literal(needle.toLowerCase())})` : null,
    meta: { type: 'match', method: 'contains' },
  } as SelectionClause;
}

/** The dashboard's time range as a clause no control owns, so every count keeps to it. */
export function timeClause(source: object, columnName: string, from: number, to: number): SelectionClause {
  const field = column(columnName);
  const iso = (ms: number) => literal(new Date(ms).toISOString());
  return {
    source,
    clients: new Set(),
    fields: [field],
    value: [from, to],
    predicate: sql`${field} >= ${iso(from)} AND ${field} < ${iso(to)}`,
    meta: { type: 'variable' },
  } as SelectionClause;
}

/**
 * Whether another source already holds a clause on this column that says the
 * same: another filters panel on the Selection, or a Mosaic panel whose brush
 * wrote the variables. Then this panel adds no clause of its own: two clauses
 * on one column would each filter the other's control by its own column.
 */
export function heldElsewhere(
  selection: Selection,
  own: Set<unknown>,
  columnName: string,
  matches: (value: unknown) => boolean
): boolean {
  return selection.clauses.some((clause) => {
    if (own.has(clause.source) || (clause.meta as { type?: string } | undefined)?.type === 'variable') {
      return false;
    }
    const columns = clauseColumns(clause);
    return columns.length === 1 && columns[0] === columnName && clause.value != null && matches(clause.value);
  });
}

/**
 * How far apart two ends may be and still be one: a hundredth of the axis, or,
 * for a brush that has not drawn its axis yet, what 12 significant digits (the
 * URL's) leave out.
 */
const toleranceOf = (span: number, value: number) =>
  Math.max(Math.abs(span) / 100, Math.abs(value) * 1e-9, Number.EPSILON);

/** An interval clause's value against a range from the URL, within a hundredth of the axis: open ends match anything. */
export function rangeMatches(value: unknown, range: [number | undefined, number | undefined], span: number): boolean {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const held = value.map(asNumber);
  return range.every((end, i) => end === undefined || Math.abs(held[i] - end) <= toleranceOf(span, end));
}

/** A points clause's value against the URL's values, in any order. */
export function valuesMatch(value: unknown, values: string[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  const held = value.map((point) => String(Array.isArray(point) ? point[0] : point));
  return held.length === values.length && held.every((v) => values.includes(v));
}

/** The span of an interval control's axis, in its units. */
export function spanOf(interactor: IntervalInteractor): number {
  const domain = interactor.scale?.domain?.map(asNumber) ?? [];
  return domain.length >= 2 ? Math.abs(domain[domain.length - 1] - domain[0]) : 0;
}

/** What the panel needs of a Mosaic mark: its channels and the columns of its last result. */
export interface BinnedMark {
  channels: Array<{ channel: string; as?: string }>;
  data?: { numRows?: number; columns?: Record<string, ArrayLike<unknown>> };
}

/**
 * The bin of a histogram's mark under a value of its axis: its ends and its
 * count, read from the result the mark last drew, so a hover queries nothing.
 */
export function binAt(mark: BinnedMark, value: number): { lo: number; hi: number; count: number } | undefined {
  const columns = mark.data?.columns;
  if (!columns) {
    return undefined;
  }
  const column = (...channels: string[]) => {
    for (const name of channels) {
      const as = mark.channels.find((c) => c.channel === name)?.as ?? name;
      if (columns[as]) {
        return columns[as];
      }
    }
    return undefined;
  };
  const x1 = column('x1');
  const x2 = column('x2');
  const y = column('y', 'y2');
  if (!x1 || !x2 || !y) {
    return undefined;
  }
  for (let i = 0; i < (mark.data?.numRows ?? x1.length); i++) {
    const lo = asNumber(x1[i]);
    const hi = asNumber(x2[i]);
    if (value >= Math.min(lo, hi) && value < Math.max(lo, hi)) {
      return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), count: Number(y[i]) };
    }
  }
  return undefined;
}

/*
 * Linked brushes. A dashboard can brush one column in several places: a
 * histogram in the filters panel, another in a Mosaic panel. Each registers
 * its brush under the column it brushes, on the Selection it writes. Then an
 * interval clause on that column, whoever made it, leaves out every
 * registered histogram, so each keeps drawing the whole column under the
 * other filters; the last brush moved is the one that counts, and the others
 * move to show it.
 */

type BrushRegistry = Map<string, Set<IntervalInteractor>>;
const brushes = new WeakMap<Selection, BrushRegistry>();

const intervalColumn = (clause: SelectionClause): string | undefined => {
  const meta = clause.meta as { type?: string } | undefined;
  const columns = meta?.type === 'interval' ? clauseColumns(clause) : [];
  return columns.length === 1 ? columns[0] : undefined;
};

const marksOf = (interactor: IntervalInteractor): unknown[] => {
  const plot = (interactor.mark as { plot?: { markSet?: Set<unknown> } } | undefined)?.plot;
  return plot?.markSet ? [...plot.markSet] : [];
};

/** The coordinators of the panels whose brushes are in a set: each keeps pre-aggregates of its own. */
function coordinatorsOf(set: Set<IntervalInteractor>): Set<{ preaggregator?: { clear(): void } }> {
  const found = new Set<{ preaggregator?: { clear(): void } }>();
  for (const interactor of set) {
    const coordinator = (interactor.mark as { coordinator?: { preaggregator?: { clear(): void } } } | undefined)
      ?.coordinator;
    if (coordinator) {
      found.add(coordinator);
    }
  }
  return found;
}

/** Shows a range on a brush without making a clause of it. */
function showRange(interactor: IntervalInteractor, value: unknown[]) {
  interactor.value = value;
  if (interactor.g && interactor.scale) {
    const extent = value.map((v) => interactor.scale!.apply(v)).sort((a, b) => a - b);
    interactor.g.call(interactor.brush.moveSilent, extent);
  }
}

function registryOf(selection: Selection): BrushRegistry {
  let registry = brushes.get(selection);
  if (registry) {
    return registry;
  }
  const made: BrushRegistry = new Map();
  registry = made;
  brushes.set(selection, made);
  // Before the coordinators hear of a clause: widen whom it leaves out to every brush on its column. Both on
  // an update and on the activation a brush announces as the pointer enters it, which is when Mosaic plans
  // its pre-aggregates, and which skip the clients a clause leaves out.
  const widen = (clause: SelectionClause) => {
    const column = clause && intervalColumn(clause);
    const peers = column ? made.get(column) : undefined;
    if (peers && peers.size > 0) {
      clause.clients = new Set([...(clause.clients ?? []), ...[...peers].flatMap(marksOf)]) as never;
    }
    return clause;
  };
  // The brush whose clause is going in while the stale ones go out: the value Mosaic emits between the two has
  // no clause on its column, and is not to clear the range that brush already holds.
  let taking: unknown;
  const update = selection.update.bind(selection);
  selection.update = (clause: SelectionClause) => {
    // A brush taking its column from another brush: that one's clause goes first, so no client, pre-aggregate
    // or mirror ever sees the two together.
    const column = clause && clause.value != null ? intervalColumn(clause) : undefined;
    const set = column ? made.get(column) : undefined;
    if (column && set?.has(clause.source as IntervalInteractor)) {
      const stale = selection.clauses.filter(
        (c) =>
          c.source !== clause.source &&
          intervalColumn(c) === column &&
          (set.has(c.source as IntervalInteractor) || isHolder(c.source))
      );
      if (stale.length > 0) {
        // Mosaic pre-aggregated for this brush as the pointer entered it, with the stale clause still in:
        // drop those tables, so they are planned again without it.
        for (const coordinator of coordinatorsOf(set)) {
          coordinator.preaggregator?.clear();
        }
        taking = clause.source;
        try {
          selection.reset(stale);
        } finally {
          taking = undefined;
        }
      }
    }
    return update(widen(clause));
  };
  const activate = selection.activate.bind(selection);
  selection.activate = (clause: SelectionClause) => activate(widen(clause));
  // After: the other brushes on a column show the range of its clause, and a stale clause left there (one
  // updated before this registry knew its brush) goes.
  selection.addEventListener('value', () => {
    for (const [column, set] of made) {
      const onColumn = selection.clauses.filter((c) => intervalColumn(c) === column);
      const latest = onColumn[onColumn.length - 1];
      // A range held through a reload (page.ts `holders`) goes too, as a brush's would.
      const stale = onColumn.filter(
        (c) => c !== latest && (set.has(c.source as IntervalInteractor) || isHolder(c.source))
      );
      if (stale.length > 0) {
        // Mosaic pre-aggregated for the winning brush with the stale clauses in, and keeps those tables while
        // that brush stays active: drop them first, so the update the reset makes plans them again.
        for (const coordinator of coordinatorsOf(set)) {
          coordinator.preaggregator?.clear();
        }
        selection.reset(stale);
      }
      // An emit waits for the queries of the one before: the brush that holds the column now keeps its range,
      // whatever an older value says (play reads it on the next frame, and stops on a cleared one).
      const holding = [taking, clausesNow(selection).filter((c) => intervalColumn(c) === column).at(-1)?.source];
      for (const interactor of set) {
        if (holding.includes(interactor)) {
          continue;
        }
        if (latest && latest.source !== interactor) {
          if (Array.isArray(latest.value)) {
            showRange(interactor, latest.value);
          }
        } else if (!latest && interactor.value) {
          interactor.reset();
        }
      }
    }
  });
  return made;
}

/** Registers a brush on its column; returns the function that takes it out. */
export function linkBrush(selection: Selection, interactor: IntervalInteractor, column: string): () => void {
  const registry = registryOf(selection);
  let set = registry.get(column);
  if (!set) {
    set = new Set();
    registry.set(column, set);
  }
  set.add(interactor);
  return () => {
    registry.get(column)?.delete(interactor);
  };
}

/**
 * Lands again the interval clauses a Selection already holds on these columns that no control of this panel made
 * (a Time Brush's window, kept through a dataset reload): the brushes linked on those columns widen them to their
 * marks, so each histogram leaves itself out as it does for a clause landing now, and show their range.
 */
export function reannounce(selection: Selection, columns: string[], own: Set<unknown>): void {
  for (const clause of [...selection.clauses]) {
    const column = intervalColumn(clause);
    if (column !== undefined && columns.includes(column) && !own.has(clause.source) && clause.value != null) {
      // A copy: the same clause again leaves the resolved list equal, and Mosaic emits nothing for it.
      selection.update({ ...clause });
    }
  }
}

/** Takes every brush's clause on a column out of the Selection: a chip's × clears them wherever they were drawn. */
export function clearColumn(selection: Selection, column: string): void {
  const onColumn = selection.clauses.filter((c) => intervalColumn(c) === column);
  if (onColumn.length > 0) {
    selection.reset(onColumn);
  }
}

/** The column an interval brush filters, when it filters one. */
export function brushColumn(interactor: IntervalInteractor): string | undefined {
  try {
    return intervalColumn(interactor.clause([0, 1]));
  } catch {
    return undefined;
  }
}
