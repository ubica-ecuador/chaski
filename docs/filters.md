# The filters panel

**Chaski Filters** (`ubica-chaski-filters-panel`) shows a dataset's cross-filters and sets them. It
reads the declarations of a filters variable (see the cross-filter section of the
[tutorial](tutorial-earthquakes.md) and `$__crossfilter`) and draws, with no query to write:

- **How many rows are left:** "2,431 of 50,000 quakes", under every active filter.
- **A control for each filter**, counted under every other filter, so it shows what picking in it
  would give:

  | Filter type    | Control                                                                             |
  | -------------- | ----------------------------------------------------------------------------------- |
  | `range`        | a histogram over the whole dataset's extent; drag across it to pick, click to clear |
  | `in`           | the column's values with their counts, picked or not; several may be picked         |
  | `equals`       | the same list; one value at a time                                                  |
  | `search`       | a text box, written once typing pauses                                              |
  | `area`, `link` | none: a map or another dataset sets them; they show as set, with a ×                |

- **A × on each filter that narrows**, and **Clear all**. A filter that is set but removes no rows (a
  map publishing its whole view) is not shown as set.

The panel writes the same variables the filters read, in the URL, so the map, the Mosaic panels and
every Chaski query follow it, and it follows them: a brush elsewhere moves its histogram.

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

## Writing the variables it sets

- A range writes its two variables, rounded to what one pixel of the histogram tells apart: to the
  minute, hour or day for times (as UTC ISO strings), to a pixel's decimal for numbers.
- An `in` filter's variable takes several values: a custom variable with **Multi-value** and
  **Include All** (All, `$__all`, is no filter), hidden, starting at All. A textbox works too.
- `equals` and `search` write one value; a hidden textbox is enough.

## How it works

- **No queries of its own.** The panel reads the filters variable from the dashboard and checks it
  with the datasource's own code, finds its dataset's table on the engine API (`window.__chaski`), and
  runs its counts there on the panels' connections: one for the counts, one per list, one per
  histogram, plus each range's extent once per loaded version of the dataset.
- **Values from the URL first**, then the template service, which follows the URL a moment later.
- It reads again when the URL changes (a variable written, here or elsewhere) and when a dataset
  reloads; the counts on screen stay until the next arrive.
