# The Mosaic panel

**Chaski Mosaic** (`ubica-chaski-mosaic-panel`) draws [Mosaic](https://idl.uw.edu/mosaic/) (vgplot)
specs on the dashboard's Chaski datasets. Brush a histogram and every other Mosaic panel filters in
the browser. A brush can also write dashboard variables, so panels on other datasources follow it.
It comes with the Chaski app and has no queries of its own: it needs at least one Chaski dataset on
the dashboard.

## A panel

The **Spec** option is a [Mosaic spec](https://idl.uw.edu/mosaic/spec/) in YAML or JSON. Its tables
are the dashboard's datasets, by name:

```yaml
params:
  brush: { select: crossfilter }
plot:
  - mark: rectY
    data: { from: quakes, filterBy: $brush }
    x: { bin: mag }
    y: { count }
  - select: intervalX
    as: $brush
```

- **What it can draw.** vgplot's marks (bars, lines, areas, dots, rects, text, rules, vectors), the
  ones it computes in DuckDB (density, contours, heatmap, raster, hexbin, regression, error bars),
  Voronoi and Delaunay, geo marks with a projection (no tiled base map: that is kepler's job), and
  the inputs `menu`, `search`, `slider` and `table`.
- **Sizes.** A single plot fills the panel. In a top-level `vconcat` or `hconcat`, the plots and
  tables without a size share the panel. Anything you size keeps its size.
- **Shared params.** Params and selections are shared by name between the Mosaic panels of a
  dashboard: give several panels the same `brush` and they filter each other. The first panel to
  define a name sets its kind.
- **Reloads.** When a dataset the panels read reloads (a new time range, a refresh), the brushes are
  cleared and every panel draws again: their bins came from the old data. Resizing a panel clears
  its own brushes too.
- **Names.** Write bare names (`from: quakes`). A qualified name such as `explore.t` is quoted whole
  by Mosaic and does not resolve.

## Writing variables

The **Write to variables** option is a YAML list. Each entry reads a selection or param of the spec
and writes dashboard variables once the brush rests (300 ms):

```yaml
- param: brush # a selection of the spec
  column: mag # its clause over this column
  from: mag_lo # an interval's ends
  to: mag_hi
- param: brush
  column: [longitude, latitude]
  variable: area # a 2-D brush, as a WKT polygon
- param: brush
  column: alert
  variable: alerts # points picked, as a multi-value variable
```

Times are written as UTC ISO strings, numbers in full; a cleared brush writes empty values. These are
the shapes the `range`, `area` and `in` filters of a filters variable read, so a filters variable
built on the same variables lets every Chaski panel follow the Mosaic panels:

```sql
SELECT count(*) FROM $quakes WHERE $__crossfilter($quakeFilters)
```

It is one way: a variable changed elsewhere does not move a brush. Don't let a dataset's own SQL read
a variable the panel writes: each write would reload the dataset, which clears the brushes.

The dev Grafana provisions two dashboards for it: **Mosaic on Chaski** (`mosaic`, 50 000 synthetic
quakes in four Mosaic panels writing variables, and a plain table following them through
`$__crossfilter`) and **Mosaic panel states** (`mosaic-states`).

## How it works

- **No second DuckDB.** The panel's Mosaic connector is the engine API on `window.__chaski`:
  `queryIPC` for Arrow queries, `exec` for the rest, on the explorer's connections, whose
  `search_path` finds datasets by bare name. Mosaic's own DuckDB-WASM connector is never bundled.
- **A coordinator per panel, params per dashboard.** Each panel builds its own Mosaic coordinator,
  so its errors are its own. Params, selections and named plots live in a map shared by the panels
  of the dashboard on screen (`src/mosaic/page.ts`).
- **Pre-aggregation.** When a brush starts, Mosaic builds small tables grouped by the brush's pixels
  in the `mosaic` schema, and each move reads those. When a dataset some panel read comes back with
  a new `loadedAt`, the schema is dropped, the selections are reset and every panel builds again.
  Chaski's first event for a dataset (its view made) changes nothing and is ignored.
- **Variables** (`src/mosaic/bridge.ts`) are written with `locationService.partial` once a param
  rests, and only those that changed.
- **Mosaic is pre-1.0** and pinned to exact versions in `package.json`. Read its source before
  relying on an API.
