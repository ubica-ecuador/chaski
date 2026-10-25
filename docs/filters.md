# The filters panel

**Chaski Filters** (`ubica-chaski-filters-panel`) shows a dataset's cross-filters and sets them. It
reads the declarations of a filters variable (see the cross-filter section of the
[tutorial](tutorial-earthquakes.md) and `$__crossfilter`) and draws, with no query to write:

- **How many rows are left:** "2,431 of 50,000 quakes" and the share as a percentage and a bar, under
  every active filter; the number eases to each new count. In a strip it sits at the right end at the
  width of its largest value, so the pills never move as it changes.
- **A control for each filter, drawn by [Mosaic](https://idl.uw.edu/mosaic/)**, counted under every
  other filter, so it shows what picking in it would give. The controls share a Mosaic crossfilter
  selection: while a brush moves, every other control and the count follow it, from tables Mosaic
  pre-aggregates when the pointer enters a control.

  | Filter type    | Control                                                                                      |
  | -------------- | -------------------------------------------------------------------------------------------- |
  | `range`        | a histogram; drag across it to pick a range, click outside the brush to clear it             |
  | `in`           | the most frequent values as bars with their counts; click one to pick it, shift-click to add |
  | `equals`       | the same bars; one value at a time                                                           |
  | `search`       | a text box; the controls follow as it is typed                                               |
  | `area`, `link` | none: a map or another dataset sets them; an area filters the controls, a link only the SQL  |

- **A colour per filter**, from Grafana's classic palette in declaration order: its bars, its brush,
  the dot on its section and its pill. Each control draws two layers: in grey, what the other filters
  leave; in the filter's colour, what its own picks or brush keep as well. So a brush leaves the bins
  outside it grey, and a picked value keeps its colour while the others grey out. Hovering a histogram
  shows the bin under the pointer and its count where the filter's value goes (in a strip, under the
  histogram), never over the bars a brush is picking.
- **A × on each filter that narrows**, and **Clear all**. A filter that is set but removes no rows (a
  map publishing its whole view) is not shown as set.

The panel writes the same variables the filters read, in the URL, once a control rests (300 ms), so
the map and every Chaski query follow it; and it follows them: a variable set elsewhere (a shared link,
a chip's ×, another panel) moves its brush or its picks. A Mosaic panel whose spec uses the same
selection name follows it live, and drives it live.

A worked example, a timeline and a sidebar over a month of USGS earthquakes driving a kepler map, is
[examples/dashboards/filters-earthquakes.json](../examples/dashboards/filters-earthquakes.json), live on
[pacha.ubica.dev](https://pacha.ubica.dev/d/filters-earthquakes).

## Options

| Option           | Default | What it does                                                                                                                                                       |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Filters variable | empty   | The filters variable to show. Empty takes the dashboard's only one.                                                                                                |
| Layout           | Auto    | Auto: a sidebar of sections when the panel is 160 px tall or more, a row of pills (each opening its control) when lower. Timeline: see below; Auto never picks it. |
| Timeline filter  | empty   | With the Timeline layout, the range filter it draws. Empty takes the first range filter over times.                                                                |
| Play             | Slide   | Slide: a window of fixed width moves along. Grow: the start stays and the end moves.                                                                               |
| Step duration    | 800     | The least time a step of play lasts, in ms (at least 400); longer while the panels the step set off still run.                                                     |
| Time column      | empty   | When set, every count keeps to the dashboard's time range over that column.                                                                                        |
| Rows are         | rows    | The noun in "N of M rows".                                                                                                                                         |
| Values shown     | 8       | How many values a list shows before "more"; longer lists get a box to find one.                                                                                    |
| Histogram bars   | 40      | Bars in a range's histogram.                                                                                                                                       |

A panel as JSON:

```json
{
  "type": "ubica-chaski-filters-panel",
  "title": "Filters",
  "gridPos": { "x": 0, "y": 0, "w": 6, "h": 20 },
  "options": { "filters": "quakeFilters", "layout": "auto", "timeColumn": "time", "noun": "quakes" }
}
```

## The timeline

With the **Timeline** layout the panel draws one range filter, usually time, the width of the panel
and the height it is given, with the other filters as pills beside its buttons. The buttons step
back, play or pause, and step forward, one bar of the histogram at a time (Mosaic rounds the bars to
a nice size: an hour, half a day, a day). Beside them, the window the brush holds.

Play starts from the window held, or, with none, from the axis's start: a tenth of the axis wide when
it slides, one bar wide when it grows. Each step is a brush like one drawn by hand: the other controls,
the count and Mosaic panels on the selection follow it live, and its variables are written once it
rests, so a kepler map reading them as its time window follows too. A step lasts at least the Step
duration, and longer while the Chaski queries it set off still run (up to 5 s more): the panel listens
to the same `ubica-duckdbwasm-activity` event kepler paces its playback on. Play stops at the axis's
end, and a drag on the histogram pauses it.

```json
{
  "type": "ubica-chaski-filters-panel",
  "title": "Timeline",
  "gridPos": { "x": 0, "y": 0, "w": 24, "h": 7 },
  "options": { "filters": "quakeFilters", "layout": "timeline", "playMode": "slide", "stepMs": 800, "bins": 60 }
}
```

For a dashboard whose data is not in Chaski, or to play the dashboard's own time range, Kepler Plus's
Time Brush panel does the same over any query.

## How it works

- **Mosaic specs made from the declarations.** The panel reads the filters variable from the dashboard,
  checks it with the datasource's own code, and draws one Mosaic spec per control on a coordinator of
  its own, over the dataset by name, as the Mosaic panel does (`src/filters/specs.ts`). The count is a
  Mosaic client of the same selection. Its params live with the Mosaic panels' (`src/mosaic/page.ts`).
- **One copy of Mosaic.** Each plugin of the app is a bundle of its own, and two copies of Mosaic
  would keep two sets of selections that never meet. The Mosaic panel's module carries Mosaic and
  hands it out on its plugin object (`src/mosaic/runtime.ts`); the filters panel loads that module
  through Grafana (`importPanelPlugin`) and bundles no Mosaic of its own.
- **The coloured layer** draws the same bars as the grey one, from the same query, and the page cuts
  it down to the control's own picks (`src/filters/paint.ts`): a range clips it to the range its brush
  holds, a list hides the bars of the values not picked. It follows the brush as it moves, with no query
  of its own: one per move used to queue behind the others, and the colour fell behind the brush.
- **To the variables** through the Mosaic panel's bridge, once a control rests; a range's ends are
  rounded to what one pixel of its axis tells apart: to the minute, hour or day for times (as UTC ISO
  strings), to a pixel's decimal for numbers.
- **From the variables** (`src/filters/sync.ts`): a value set elsewhere is applied to the control, so
  its brush or its picks show it. A value the control already holds, within a pixel, is its own write
  coming back and is left alone; a value another source on the selection already holds (a second
  filters panel, a Mosaic panel's brush) is left to it, so no column is filtered twice.
- **A search** is the panel's own text box, with a case-insensitive clause as Chaski's `search` filter
  reads it, so the controls count what the dashboard's SQL shows.
- **The time range**, when a time column is set, is a clause on the selection that no control writes;
  a new range replaces it in place, without drawing the controls again.
- **Linked brushes** (`linkBrush` in `src/filters/sync.ts`). A column can be brushed in several places:
  this panel's histogram, a Mosaic panel's, a second filters panel. Each registers its brush under its
  column; an interval clause on that column, whoever made it, leaves out every registered histogram, so
  each keeps drawing the whole column; the brush moved last takes the column (the other brushes' clauses
  go, and they move to show its range); clearing the filter clears it wherever it was drawn. Each panel
  writes only what its own brushes did, so a range is written once.
- **Pre-aggregates** are off while the controls read their columns, and dropped when one brush takes a
  column from another: Mosaic plans them as the pointer enters a brush, with the other clauses as they
  are then.
- **Narrowing** (whether a set filter is shown as set) is one SQL count per variable change, on the
  panels' connections.

## Writing the variables it sets

- An `in` filter's variable takes several values: a custom variable with **Multi-value** and
  **Include All** (All, `$__all`, is no filter), hidden, starting at All. A textbox works too.
- `equals` and `search` write one value; a hidden textbox is enough.
