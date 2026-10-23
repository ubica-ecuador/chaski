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
  outside it grey, and a picked value keeps its colour while the others grey out. Histograms have a
  tooltip with the bin and its count.
- **A × on each filter that narrows**, and **Clear all**. A filter that is set but removes no rows (a
  map publishing its whole view) is not shown as set.

The panel writes the same variables the filters read, in the URL, once a control rests (300 ms), so
the map and every Chaski query follow it; and it follows them: a variable set elsewhere (a shared link,
a chip's ×, another panel) moves its brush or its picks. A Mosaic panel whose spec uses the same
selection name follows it live, and drives it live.

## Options

| Option           | Default | What it does                                                                                                             |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| Filters variable | empty   | The filters variable to show. Empty takes the dashboard's only one.                                                      |
| Layout           | Auto    | Auto: a sidebar of sections when the panel is 160 px tall or more, a row of pills (each opening its control) when lower. |
| Time column      | empty   | When set, every count keeps to the dashboard's time range over that column.                                              |
| Rows are         | rows    | The noun in "N of M rows".                                                                                               |
| Values shown     | 8       | How many values a list shows before "more"; longer lists get a box to find one.                                          |
| Histogram bars   | 40      | Bars in a range's histogram.                                                                                             |

A panel as JSON:

```json
{
  "type": "ubica-chaski-filters-panel",
  "title": "Filters",
  "gridPos": { "x": 0, "y": 0, "w": 6, "h": 20 },
  "options": { "filters": "quakeFilters", "layout": "auto", "timeColumn": "time", "noun": "quakes" }
}
```

## How it works

- **Mosaic specs made from the declarations.** The panel reads the filters variable from the dashboard,
  checks it with the datasource's own code, and draws one Mosaic spec per control on a coordinator of
  its own, over the dataset by name, as the Mosaic panel does (`src/filters/specs.ts`). The count is a
  Mosaic client of the same selection. Its params live with the Mosaic panels' (`src/mosaic/page.ts`).
- **One copy of Mosaic.** Each plugin of the app is a bundle of its own, and two copies of Mosaic
  would keep two sets of selections that never meet. The Mosaic panel's module carries Mosaic and
  hands it out on its plugin object (`src/mosaic/runtime.ts`); the filters panel loads that module
  through Grafana (`importPanelPlugin`) and bundles no Mosaic of its own.
- **The coloured layer** filters on `<selection>__all`, an intersect selection the panel keeps holding
  every clause of the crossfilter one, its own included.
- **To the variables** through the Mosaic panel's bridge, once a control rests; a range's ends are
  rounded to what one pixel of its axis tells apart: to the minute, hour or day for times (as UTC ISO
  strings), to a pixel's decimal for numbers.
- **From the variables** (`src/filters/sync.ts`): a value set elsewhere is applied to the control, so
  its brush or its picks show it. A value the control already holds, within a pixel, is its own write
  coming back and is left alone; a value another source on the selection already holds (a second
  filters panel, a Mosaic panel's brush) is left to it, so no column is filtered twice.
- **A search** is the panel's own text box, with a case-insensitive clause as Chaski's `search` filter
  reads it, so the controls count what the dashboard's SQL shows.
- **The time range**, when a time column is set, is a clause on the selection that no control writes.
- **Narrowing** (whether a set filter is shown as set) is one SQL count per variable change, on the
  panels' connections.

## Writing the variables it sets

- An `in` filter's variable takes several values: a custom variable with **Multi-value** and
  **Include All** (All, `$__all`, is no filter), hidden, starting at All. A textbox works too.
- `equals` and `search` write one value; a hidden textbox is enough.
