import type { FilterDeclaration, RangeFilter } from '../engine/crossfilter';
import type { VariableLink } from '../mosaic/bridge';

/*
 * The filters panel draws its controls with Mosaic: a spec per filter, made
 * from its declaration. Every control is a client of one crossfilter
 * Selection, so a brush in one filters the others while it moves, from
 * pre-aggregated tables, and so does any Mosaic panel on that Selection.
 * The variables are written once a control rests, by the Mosaic panel's
 * bridge.
 */

export type ValueFilter = Extract<FilterDeclaration, { type: 'in' | 'equals' }>;

export interface ControlLook {
  /** The bars that the other filters leave. */
  fill: string;
  /** Labels and counts. */
  text: string;
  width: number;
}

const HISTOGRAM_HEIGHT = 64;
const ROW_HEIGHT = 20;

/** The name of the Selection a value filter's picks also go to, for highlighting them. */
export const pickParam = (selection: string, filter: string) => `${selection}__${filter}`;

const brushStyle = (look: ControlLook) => ({
  fill: look.fill,
  'fill-opacity': 0.18,
  stroke: look.fill,
  'stroke-opacity': 0.9,
});

/**
 * A histogram of the column under the other filters; drag across it to pick a
 * range. The y axis fits the rows left, so the shape stays readable however
 * narrow the other filters are.
 */
export function rangeSpec(dataset: string, filter: RangeFilter, selection: string, bins: number, look: ControlLook) {
  return {
    params: { [selection]: { select: 'crossfilter' } },
    plot: [
      {
        mark: 'rectY',
        data: { from: dataset, filterBy: `$${selection}` },
        x: { bin: filter.column, steps: bins },
        y: { count: null },
        fill: look.fill,
        inset: 0.5,
      },
      { select: 'intervalX', as: `$${selection}`, brush: brushStyle(look) },
    ],
    xDomain: 'Fixed',
    yAxis: null,
    xLabel: null,
    xTicks: 3,
    xTickSize: 3,
    width: Math.max(80, Math.floor(look.width)),
    height: HISTOGRAM_HEIGHT,
    marginTop: 4,
    marginBottom: 20,
    marginLeft: 8,
    marginRight: 12,
  };
}

/**
 * The column's most frequent values as bars with their counts under the other
 * filters. A click picks a value, a shift-click adds one; the picked ones stay
 * bright, the others dim.
 */
export function valuesSpec(
  dataset: string,
  filter: ValueFilter,
  selection: string,
  values: string[],
  labelWidth: number,
  look: ControlLook
) {
  const pick = pickParam(selection, filter.name);
  const data = { from: dataset, filterBy: `$${selection}` };
  return {
    params: { [selection]: { select: 'crossfilter' }, [pick]: { select: 'single' } },
    plot: [
      { mark: 'barX', data, x: { count: null }, y: filter.column, fill: look.fill, insetTop: 2, insetBottom: 2 },
      { select: 'toggleY', as: `$${selection}` },
      { select: 'toggleY', as: `$${pick}` },
      { select: 'highlight', by: `$${pick}`, opacity: 0.3 },
      {
        mark: 'text',
        data,
        x: { count: null },
        y: filter.column,
        text: { count: null },
        dx: 4,
        textAnchor: 'start',
        fill: look.text,
        fontSize: 11,
      },
    ],
    yDomain: values,
    xAxis: null,
    xLabel: null,
    yLabel: null,
    yTickSize: 0,
    yTickPadding: 6,
    width: Math.max(80, Math.floor(look.width)),
    height: Math.max(1, values.length) * ROW_HEIGHT + 8,
    marginTop: 4,
    marginBottom: 4,
    marginLeft: labelWidth,
    // Room for the count after the longest bar.
    marginRight: 48,
  };
}

/** Enough left margin for the longest value shown, within a third of the width. */
export function labelWidth(values: string[], width: number): number {
  const longest = values.reduce((n, v) => Math.max(n, v.length), 1);
  return Math.round(Math.min(width / 3, Math.max(32, longest * 6.5 + 8)));
}

/**
 * The variables each control writes, as the Mosaic panel's links: a range
 * its two ends, a list of values its variable, a search its text.
 */
export function controlLinks(filters: FilterDeclaration[], selection: string): VariableLink[] {
  const links: VariableLink[] = [];
  for (const f of filters) {
    if (f.type === 'range') {
      links.push({ param: selection, column: f.column, from: f.from, to: f.to });
    } else if (f.type === 'in' || f.type === 'equals' || f.type === 'search') {
      links.push({ param: selection, column: f.column, variable: f.variable });
    }
  }
  return links;
}
