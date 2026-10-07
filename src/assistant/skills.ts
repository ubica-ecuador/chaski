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
