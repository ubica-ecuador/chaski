import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import { column, literal, sql } from '@uwdata/mosaic-sql';

import { clauseColumns } from '../mosaic/bridge';

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
  scale?: { type?: string; domain?: unknown[]; range?: number[]; apply(value: unknown): number };
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
  if (held && held.length === 2 && held.every((v, i) => Math.abs(v - ends[i]) <= pixel)) {
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

/** An interval clause's value against a range from the URL, within a hundredth of the axis: open ends match anything. */
export function rangeMatches(value: unknown, range: [number | undefined, number | undefined], span: number): boolean {
  if (!Array.isArray(value) || value.length !== 2) {
    return false;
  }
  const held = value.map(asNumber);
  const tolerance = Math.abs(span) / 100;
  return range.every((end, i) => end === undefined || Math.abs(held[i] - end) <= tolerance);
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
