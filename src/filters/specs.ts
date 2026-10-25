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
  /** The filter's own colour: its brush, and what its picks keep. */
  colour: string;
  /** The bars' paint in that colour: the colour itself, or a gradient as `url(#id)`. */
  paint: string;
  /** What the other filters leave but this one's picks do not. */
  muted: string;
  /** Labels and counts. */
  text: string;
  width: number;
}

const HISTOGRAM_HEIGHT = 64;
const ROW_HEIGHT = 20;

const brushStyle = (look: ControlLook) => ({
  fill: look.colour,
  'fill-opacity': 0.12,
  stroke: look.colour,
  'stroke-opacity': 0.9,
});

/*
 * Each control is two layers of the same bars, from the same query. Behind, in
 * grey, what the other filters leave: the crossfilter Selection leaves a
 * control's own clause out. In front, in the filter's colour, those bars cut
 * down in the page to what the control's own picks keep (see paint.ts): a
 * range clips them to its brush, a list hides the values not picked. So picks
 * and brushes show in colour and the rest greys out, and a brush paints at the
 * pointer's pace: its own bars need no query. The coloured layer lets pointers
 * through to the grey one, which takes the clicks, drags and tips.
 */

/** A histogram of the column under the other filters; drag across it to pick a range. */
export function rangeSpec(dataset: string, filter: RangeFilter, selection: string, bins: number, look: ControlLook) {
  const layer = {
    mark: 'rectY',
    data: { from: dataset, filterBy: `$${selection}` },
    x: { bin: filter.column, steps: bins },
    y: { count: null },
    inset: 0.5,
  };
  return {
    params: { [selection]: { select: 'crossfilter' } },
    plot: [
      // No tip: on a short histogram it covers the brush. The panel shows the bin under the pointer instead.
      { ...layer, fill: look.muted },
      { select: 'intervalX', as: `$${selection}`, brush: brushStyle(look) },
      { ...layer, fill: look.paint, pointerEvents: 'none' },
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
 * filters. A click picks a value, a shift-click adds one; the picked ones keep
 * their colour, the others grey out.
 */
export function valuesSpec(
  dataset: string,
  filter: ValueFilter,
  selection: string,
  values: string[],
  labelWidth: number,
  look: ControlLook
) {
  const data = { from: dataset, filterBy: `$${selection}` };
  const layer = { mark: 'barX', data, x: { count: null }, y: filter.column, insetTop: 2, insetBottom: 2 };
  return {
    params: { [selection]: { select: 'crossfilter' } },
    plot: [
      { ...layer, fill: look.muted },
      { select: 'toggleY', as: `$${selection}` },
      { ...layer, fill: look.paint, pointerEvents: 'none' },
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
        pointerEvents: 'none',
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
