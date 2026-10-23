import type { DatasetVariableQuery, DuckQuery } from '../types';

/**
 * What an assistant needs to write SQL for Chaski panels. Exported for pasting
 * into the Grafana Assistant's instructions (docs/grafana-assistant.md quotes
 * it); skills.test.ts holds its macros to src/engine/macros.ts.
 */
export const chaskiAssistantSkill = `# Chaski (DuckDB in the browser)
Chaski loads a dashboard's datasets once into DuckDB running in the viewer's browser and answers
every panel query there. You cannot run Chaski queries: they never reach the server. Write the SQL
for the panel and let the dashboard run it. The live context "Chaski datasets (live)" lists the
datasets on screen with their columns and DuckDB types; use those names.
A dataset is a hidden query variable of this datasource (kind 'dataset'). Panel SQL reads it as
$name, e.g. SELECT route, count(*) FROM $vehicles GROUP BY 1. Other dashboard variables are quoted
like the server DuckDB datasource: $x → 'value', multi-value → 'a','b', \${x:raw} verbatim.
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
Geometry columns reach panels as WKB hex; for a map with many rows select ST_AsGeoJSON(geom).`;

/** A dataset variable as a dashboard's templating list holds it. A test holds it to the provisioned dashboards. */
export const exampleDatasetVariable = {
  name: 'vehicles',
  type: 'query',
  hide: 2,
  skipUrlSync: true,
  refresh: 2,
  datasource: { type: 'ubica-chaski-datasource', uid: '<chaski uid>' },
  query: {
    refId: 'vehicles',
    kind: 'dataset',
    name: 'vehicles',
    source: {
      type: 'sql',
      sql: "SELECT * FROM read_parquet('https://example.org/vehicles.parquet') WHERE $__timeFilter(t)",
    },
  } satisfies DatasetVariableQuery,
};

/** A panel target reading that dataset. */
export const examplePanelTarget = {
  refId: 'A',
  datasource: { type: 'ubica-chaski-datasource', uid: '<chaski uid>' },
  rawSql:
    'SELECT $__timeGroup(t, 1h) AS time, count(*) AS n FROM $vehicles WHERE $__timeFilter(t) GROUP BY 1 ORDER BY 1',
} satisfies DuckQuery;

/** What an assistant building a whole dashboard on Chaski gets wrong without being told. */
export const dashboardAuthoringSkill = `# Authoring dashboards on Chaski
Each dataset is a dashboard variable in templating.list: type 'query', hide 2, skipUrlSync true,
datasource Chaski, and a query object with kind 'dataset', the dataset's name (the same as the
variable's) and a source: {"type":"sql","sql":…} to read a URL that allows CORS or derive from
another dataset, or {"type":"datasource","datasource":{type,uid},"query":{…}} to load from another
Grafana datasource. refresh 1 loads on dashboard load; refresh 2 also on time-range change.
Example variable:
${JSON.stringify(exampleDatasetVariable)}
A panel target on Chaski has only refId, datasource and rawSql:
${JSON.stringify(examplePanelTarget)}
Put datasets before the variables and panels that read them. Values variables (dropdowns) use
kind 'values' with sql whose first column is the value.`;

/** A Mosaic panel as a dashboard's panels list holds it. A test parses its options as the panel does. */
export const exampleMosaicPanel = {
  type: 'ubica-chaski-mosaic-panel',
  title: 'Magnitude',
  gridPos: { x: 0, y: 0, w: 8, h: 8 },
  options: {
    spec: `params:
  brush: { select: crossfilter }
plot:
  - mark: rectY
    data: { from: quakes, filterBy: $brush }
    x: { bin: mag }
    y: { count: }
  - select: intervalX
    as: $brush
xDomain: Fixed
`,
    variables: `- param: brush
  column: mag
  from: mag_lo
  to: mag_hi
`,
    reads: '',
    preaggregate: true,
  },
};

/** What an assistant adding Mosaic panels to a Chaski dashboard needs, and what it gets wrong without it. */
export const mosaicAuthoringSkill = `# Mosaic panels on Chaski
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
${JSON.stringify(exampleMosaicPanel)}
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
  scale to millions of rows; plain dot marks over millions of rows do not.`;
