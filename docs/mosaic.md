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
  variable: area # a 2-D brush on a map, as a WKT polygon
- param: box
  column: [flipper_length, body_mass]
  from: [flip_lo, mass_lo] # any other 2-D brush: one range per axis
  to: [flip_hi, mass_hi]
- param: brush
  column: alert
  variable: alerts # points picked, as a multi-value variable
```

Times are written as UTC ISO strings, numbers to 12 significant digits; a cleared brush writes empty
values. These are the shapes the `range`, `area` and `in` filters of a filters variable read. Keep
the WKT polygon for longitude and latitude: the `area` filter wraps its x at ±180, so on other axes it
would move the box. A filters variable built on the same variables lets every Chaski panel follow the
Mosaic panels:

```sql
SELECT count(*) FROM $quakes WHERE $__crossfilter($quakeFilters)
```

A variable changed elsewhere does not move a brush; the other way in is below. Don't let a dataset's
own SQL read a variable the panel writes: each write would reload the dataset, which clears the
brushes.

## Reading variables

The **Read from variables** option goes the other way: dashboard variables written elsewhere become
clauses of a selection of the spec, and every Mosaic panel on that selection follows them. That is
how a kepler map drives Mosaic: kepler publishes its viewport as four variables and a drawn area as
WKT.

```yaml
- param: brush
  column: [pickup_lon, pickup_lat]
  area: map_area # a WKT polygon, as kepler's drawn area writes it
- param: brush
  column: pickup_lon
  from: view_w # a range; an empty end is open (kepler's viewport edges)
  to: view_e
- param: brush
  column: paid
  values: payment # a multi-value variable
```

- Values are read from the URL, as kepler does, and followed as it changes. Numbers and ISO times
  are ranges; an area is rebuilt from the numbers in the WKT, so nothing else of the variable reaches
  the SQL, and is tested with `ST_Contains` behind its bounding box.
- Declare each read in one panel: each panel adds its own clause.
- A panel cannot read a variable it writes, and a clause read from a variable is never written back.

For a tour, see [examples/](../examples/README.md): a gallery of five of Mosaic's examples, a
dashboard of its density visualizations, 5 million Gaia stars, and New York taxi rides where Mosaic
and a kepler map drive each other. The dev Grafana also provisions two dashboards for it: **Mosaic on Chaski** (`mosaic`, 50 000 synthetic
quakes in four Mosaic panels writing variables, and a plain table following them through
`$__crossfilter`) and **Mosaic panel states** (`mosaic-states`).

## A kepler map in the Selection

Variables move once a brush rests, through the URL. A kepler map can instead join a Selection
directly: set its **Cross-filtering → Mosaic selection** to the Selection's name (`brush` for
`as: $brush`). Its range, time and multi-select filters are then clauses on their columns, sent while
they move, and the brushes and picks here land on the map's filter of the same column; with
**Mosaic view columns** (`longitude, latitude`) what the map shows is a bounding box too. Name the
map's columns as the dataset names them. A histogram of a column the map filters shows the map's
window as its brush.

The map gets this from the Mosaic panel's module, as the filters panel does:
`mosaicRuntime.sharedSelection(name, signal)` returns the dashboard's Selection of that name (made a
crossfilter one if no panel has), with `clauseInterval`, `clauseIntervals`, `clausePoints` and
`clauseColumns` beside it. Those keep their shapes across releases.

## How it works

- **No second DuckDB.** The panel's Mosaic connector is the engine API on `window.__chaski`:
  `queryIPC` for Arrow queries, `exec` for the rest, on the explorer's connections, whose
  `search_path` finds datasets by bare name. Mosaic's own DuckDB-WASM connector is never bundled.
- **One copy of Mosaic for the app.** The panel's module also hands its Mosaic out on its plugin
  object (`src/mosaic/runtime.ts`), and the filters panel draws with that copy, so both share
  selections by name: brush one, and the other follows as the brush moves.
- **Linked brushes.** A 1-D brush on a column is linked to every other brush on that column and
  selection, in this panel or a filters panel: each shows the range of the one moved last, and a
  panel writes variables only for clauses its own interactors made.
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
- **Patched where it breaks** (`src/mosaic/patches.ts`). In 0.34 a 2-D grid mark (contour, heatmap,
  raster) over no rows throws. The plot then never renders again, and the selection waits for it, so a
  brush that left nothing froze every Mosaic panel on the dashboard. The patch gives an empty grid its
  columns.
