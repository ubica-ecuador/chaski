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

## Teaching it Chaski

The Assistant knows a lot about SQL and Grafana, but not Chaski's conventions. Where your Grafana
lets you give the Assistant standing instructions or custom skills, paste this:

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
A dataset that reloads on time-range change keeps its table when the new range fits inside the
loaded one, so its source must return plain rows for the range (no ORDER BY … LIMIT, no totals),
and panels reading it must filter by time themselves with $__timeFilter.
Geometry columns reach panels as WKB hex; for a map with many rows select ST_AsGeoJSON(geom).
```

## Authoring whole dashboards

Asked to build a dashboard on Chaski, an assistant needs the exact JSON of a dataset variable and of
a panel target. Paste this beside the text above:

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

## Source of truth

Both texts are exported from the plugin's code, `chaskiAssistantSkill` and `dashboardAuthoringSkill`
in `src/assistant/skills.ts`; this page quotes them. Tests hold them to the plugin: every macro
they name is one Chaski expands, and the example variable has the shape of the dataset variables in
the provisioned dashboards. The plugin is a datasource, and Grafana lets only app plugins register
skills with the Assistant, so the texts are pasted by hand.
