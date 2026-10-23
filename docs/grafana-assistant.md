# Grafana Assistant

On a Grafana that has the **Grafana Assistant** (Grafana Cloud, and self-managed installations where
the Assistant app is available), a dashboard served by Chaski tells the Assistant which datasets are
loaded in the browser, and two starter questions appear in its sidebar. On a Grafana without the
Assistant (OSS, or a version that predates it) nothing is registered and nothing changes.

## What the Assistant sees

While a Chaski dashboard is on screen, the Assistant's page context holds an item titled
**Chaski datasets (live)** with, for each dataset:

- its **name**, how **panel SQL** reads it (`$vehicles`) and how the engine API and the explorer
  read it (`datasets."vehicles"`);
- its **row count** and **when it was loaded**, plus the error of the latest reload when that
  reload failed and the panels still show the previous data;
- its **columns with their DuckDB types**, so the Assistant writes SQL with real names.

It also carries the dashboard's **time range** from the URL, as absolute times.

- The item belongs to that dashboard's URL (`/d/<uid>`). Leaving for a dashboard on another
  datasource takes it away; Explore and unsaved dashboards register nothing.
- It follows the dashboard: a dataset that loads a new version, another dashboard coming on screen,
  or a new time range rebuilds it. A burst of loads rebuilds it once.
- The columns come from a `DESCRIBE` of each dataset's view, run once per loaded version on the
  explorer's connections, so it does not count toward `ubica-duckdbwasm-activity`.
- Nothing calls a backend: the context lives in the browser and is read only when the Assistant is
  opened.

## What it cannot do

The Assistant **cannot run Chaski queries**. They run in the viewer's browser and never reach
Grafana's server, so the Assistant's own query tools do not see them. It can write the SQL, edit a
panel or build a dashboard; the dashboard runs the queries.

## Skills

The Chaski app registers three skills with the Assistant. The Assistant keeps one catalog line for each
in its prompt and loads the body when a conversation needs it or the user attaches it:

| Skill                                       | What it teaches                                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `plugin:ubica-chaski-app:chaski-sql`        | Panel SQL on Chaski: datasets as `$name`, the macros, cross-filters                |
| `plugin:ubica-chaski-app:chaski-dashboards` | The exact JSON of a dataset variable and a panel target                            |
| `plugin:ubica-chaski-app:chaski-mosaic`     | Mosaic panels: options, specs over datasets, writing and reading variables, kepler |

It also offers two starters on a fresh chat: a dashboard from a Parquet file, and Mosaic linked
views. The Assistant loads the app's module only to read them, and on a Grafana without the
Assistant nothing loads.

The skills appear on the Assistant's Skills settings page, attributed to Chaski. Whether their bodies
reach the model depends on the Assistant's version: plugin skills arrive with its agent-skills
runtime. Where they don't yet, or on a Grafana that lets you give the Assistant standing instructions
instead, paste the texts below.

### Chaski panel SQL

```text
# Chaski (DuckDB in the browser)
Chaski loads a dashboard's datasets once into DuckDB running in the viewer's browser and answers
every panel query there. You cannot run Chaski queries: they never reach the server. Write the SQL
for the panel and let the dashboard run it. The live context "Chaski datasets (live)" lists the
datasets on screen with their columns and DuckDB types; use those names.
A dataset is a hidden query variable of this datasource (kind 'dataset'). Panel SQL reads it as
$name, e.g. SELECT route, count(*) FROM $vehicles GROUP BY 1. Other dashboard variables are quoted
like the server DuckDB datasource: $x → 'value', multi-value → 'a','b', ${x:raw} verbatim.
Macros: $__timeFilter(col), $__timeFrom(), $__timeTo(), $__timeGroup(col, 1h) (a time_bucket),
$__proxy('path') (a file read through Grafana's data proxy with the datasource's credentials).
Cross-filters: a hidden variable of kind 'filters' declares a dataset's filters (range, in, equals,
search, area, link), each a column and the dashboard variables that narrow it, all written $name.
$__crossfilter($quakeFilters, -own) is the AND of the active ones except the panel's own (the one
whose variables that panel writes); $__filters($quakeFilters) is a table of them for a filter bar.
The Chaski Filters panel (type 'ubica-chaski-filters-panel', no targets, options.filters naming the
filters variable) shows and sets them: a count, and a control per filter counted under the others;
options.layout 'timeline' draws one range filter over times the panel's width, with play.
A dataset that reloads on time-range change keeps its table when the new range fits inside the
loaded one, so its source must return plain rows for the range (no ORDER BY … LIMIT, no totals),
and panels reading it must filter by time themselves with $__timeFilter.
Geometry columns reach panels as WKB hex; for a map with many rows select ST_AsGeoJSON(geom).
```

### Building a dashboard on Chaski

Asked to build a dashboard on Chaski, an assistant needs the exact JSON of a dataset variable and of
a panel target:

```text
# Authoring dashboards on Chaski
Each dataset is a dashboard variable in templating.list: type 'query', hide 2, skipUrlSync true,
datasource Chaski, and a query object with kind 'dataset', the dataset's name (the same as the
variable's) and a source: {"type":"sql","sql":…} to read a URL that allows CORS or derive from
another dataset, or {"type":"datasource","datasource":{type,uid},"query":{…}} to load from another
Grafana datasource. refresh 1 loads on dashboard load; refresh 2 also on time-range change.
Example variable:
{"name":"vehicles","type":"query","hide":2,"skipUrlSync":true,"refresh":2,"datasource":{"type":"ubica-chaski-datasource","uid":"<chaski uid>"},"query":{"refId":"vehicles","kind":"dataset","name":"vehicles","source":{"type":"sql","sql":"SELECT * FROM read_parquet('https://example.org/vehicles.parquet') WHERE $__timeFilter(t)"}}}
A panel target on Chaski has only refId, datasource and rawSql:
{"refId":"A","datasource":{"type":"ubica-chaski-datasource","uid":"<chaski uid>"},"rawSql":"SELECT $__timeGroup(t, 1h) AS time, count(*) AS n FROM $vehicles WHERE $__timeFilter(t) GROUP BY 1 ORDER BY 1"}
Put datasets before the variables and panels that read them. Values variables (dropdowns) use
kind 'values' with sql whose first column is the value.
```

### Mosaic panels

```text
# Mosaic panels on Chaski
The Chaski Mosaic panel (type 'ubica-chaski-mosaic-panel') draws a Mosaic (vgplot) spec over the
dashboard's Chaski datasets: brush one chart and every Mosaic panel on the same selection filters in
the browser. It has no queries (targets stay empty); the dashboard needs at least one Chaski dataset.
Its options, all strings of YAML (or JSON) except the last:
- spec: a Mosaic spec (idl.uw.edu/mosaic/spec). Tables are datasets by bare name: data: { from:
  quakes, filterBy: $brush }. Never $quakes and never a qualified name such as explore.t.
- variables: writes. Each entry: param (a selection or param of the spec), column (the clause's
  column), then from/to for an interval, or variable for points (a multi-value variable), text, a
  param's value, or a 2-D brush over [longitude, latitude] (a WKT polygon). Any other 2-D brush
  writes one range per axis: column [x, y], from [x_lo, y_lo], to [x_hi, y_hi].
- reads: variables written elsewhere (a kepler map's viewportVariables or areaVariable, a picker)
  become clauses of a selection. Each entry: param, column, then from/to for a range, area for a WKT
  polygon over [longitude, latitude], or values for a multi-value variable. A panel cannot read a
  variable it writes; declare each read in one panel only.
- preaggregate: true (the default) builds small tables when a brush starts; keep it on.
Example panel:
{"type":"ubica-chaski-mosaic-panel","title":"Magnitude","gridPos":{"x":0,"y":0,"w":8,"h":8},"options":{"spec":"params:\n  brush: { select: crossfilter }\nplot:\n  - mark: rectY\n    data: { from: quakes, filterBy: $brush }\n    x: { bin: mag }\n    y: { count: }\n  - select: intervalX\n    as: $brush\nxDomain: Fixed\n","variables":"- param: brush\n  column: mag\n  from: mag_lo\n  to: mag_hi\n","reads":"","preaggregate":true}}
On a v2 dashboard the same options go in the element's vizConfig: { kind: 'VizConfig', group:
'ubica-chaski-mosaic-panel', spec: { options: {…}, fieldConfig: { defaults: {}, overrides: [] } } },
with data.spec.queries empty.
Linking with the rest of the dashboard:
- Params and selections are shared by name between all Mosaic panels of a dashboard; the first panel
  to define one sets its kind, so declare it the same way (params: brush: { select: crossfilter }) in
  every panel that uses it, and use one selection name per dataset.
- Written variables are hidden textbox variables (one per from, to or variable), never custom
  dropdowns: a custom variable defaults to its first option and would filter at load.
- Chaski SQL panels follow the brushes through a filters variable built on those same variables:
  a range filter per interval (from '$x_lo', to '$x_hi'), an area filter per WKT variable (only
  longitude and latitude: it wraps x at ±180), an in filter per points variable. Then SELECT count(*)
  FROM $quakes WHERE $__crossfilter($quakeFilters).
- A dataset's own SQL must not read a variable a Mosaic panel writes: each write would reload the
  dataset, and a reload clears every brush.
- To have a kepler map drive Mosaic, give the kepler panel viewportVariables {west, south, east,
  north} and areaVariable, and put reads in one Mosaic panel; the kepler query then leaves out the
  filters built on its own variables: $__crossfilter($f, -drawn, -view_lng, -view_lat).
Writing specs that work:
- Sizes: a single plot fills the panel; plots in a top-level vconcat or hconcat share it unless
  sized. Put a legend in its own vconcat item with for: <plot name>, or it spills out of the panel.
- Rasters, contours and heatmaps: use dark-ended schemes (magma, viridis, inferno) on a dark theme;
  blues and oranges start at white.
- Do not add a highlight interactor to aggregated marks (bins, counts) whose selection also filters
  other columns: their query fails with a DuckDB Binder Error.
- Names that are SQL keywords (lambda, order, group) must be renamed in the dataset's SQL.
- Inputs: menu, search, slider and table; geo marks take a projection but draw no base map (that is
  kepler's job).
- Mosaic's marks that compute in DuckDB (density, contours, heatmap, raster, hexbin, regression)
  scale to millions of rows; plain dot marks over millions of rows do not.
```

## Source of truth

The texts are exported from the plugin's code, `chaskiAssistantSkill`, `dashboardAuthoringSkill` and
`mosaicAuthoringSkill` in `src/assistant/skills.ts`, and registered by `src/assistant/manifest.ts`;
this page quotes them. Tests hold them to the plugin: every macro they name is one Chaski expands,
the example variable has the shape of the dataset variables in the provisioned dashboards, the example
Mosaic panel parses as the panel parses it, and the manifest keeps within the Assistant's bounds and is
declared in `plugin.json`.
