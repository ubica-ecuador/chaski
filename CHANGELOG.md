# Changelog

## 2.3.0 (2026-10-27)

- **Smooth play on the timeline** (Motion: Smooth, by default): the window glides instead of jumping a
  bar at a time, and the filters, the Mosaic panels and a kepler map on the same selection follow every
  frame. **By step** keeps the old play.
- **Play from any window**: the timeline also plays from a window set by another panel, a kepler map
  or a shared link.
- **The dashboard keeps its window on reload**: an auto-refresh, Refresh or a new time range no longer
  opens a brushed window, or a Kepler Plus Time Brush's, to the whole range.
- **Faster filters panel**: controls out of view (a closed pill or section, a panel scrolled away) wait
  until they show, so dragging a brush answers several times faster on a dashboard with many filters.
- **Fixes**:
  - A brush stays where you let it go, and the coloured bars follow it while it moves or plays.
  - Histograms with no brush show their colour, and their whole range after a reload.
  - Several Mosaic panels sharing a pre-aggregated table no longer fail with a DuckDB write conflict.
  - A panel waiting for the engine shows a spinner.
- **The catalog page shows Chaski at work** in four live dashboards on pacha.ubica.dev.
- **Examples**: a month of USGS earthquakes with the filters panel driving a kepler map, Gaia cards
  that follow the brushes, and New York taxi trips as flows.

## 2.2.0 (2026-10-24)

- **Filters panel.** `ubica-chaski-filters-panel` shows a dataset's cross-filters and sets them, with no
  query to write: how many rows they leave, a × on each and Clear all, and a control per filter drawn
  by Mosaic, counted under the others and following each other live as a brush moves: values to pick
  (`in`, `equals`), a histogram to brush (`range`), a text box (`search`). Mosaic panels on the same
  selection drive it and follow it live: the Mosaic panel's module now hands its copy of Mosaic to the
  filters panel. A colour per filter, the bins outside a brush and the values not picked in grey,
  tooltips, and the share of rows left as a bar. Tall, it is a sidebar of sections; low, a strip of
  pills that open their control, with the count at the end so the pills never move. Brushes on one
  column are linked across panels: each shows the range of the one moved last. A new time range moves
  the counts without drawing the controls again.
  Unsigned builds must also allow `ubica-chaski-filters-panel`. See docs/filters.md.
- **Timeline.** The filters panel's Timeline layout draws one range filter, usually time, the width of
  the panel, with the other filters as pills, and plays its brush a bar at a time: a window that
  slides, or one that grows. Each step filters every control and Mosaic panel live and writes its
  variables, so maps reading them follow; it waits for the Chaski queries it set off before the next.
- **Selections shared with other plugins.** The Mosaic panel's runtime also hands out
  `sharedSelection(name)`, the dashboard's Selection of that name (a crossfilter one when no panel
  made it), and Mosaic's clause builders, so a panel of another plugin takes part in it without a
  copy of Mosaic: the kepler map's filters are clauses in it, sent as they move, and its brushes
  land on the map; `clauseArea` makes the figure drawn on the map a clause on longitude and latitude
  (a bounding box, then `ST_Contains`), and the Kepler Plus Time Brush's window is a clause on time.
  These keep their shapes from now on.
- **Range reads.** A datasource setting, off by default, that reads remote Parquet files by HTTP
  range requests instead of downloading them whole (DuckDB-WASM forces full reads unless told
  otherwise). Worth it for a time window of a large file sorted by time, or a few of its columns;
  slower when a dataset reads most of a file. Save & test says when the engine reads by ranges. See
  Requirements in the README.

## 2.1.0 (2026-10-23)

- **Grafana Assistant skills.** Now that Chaski is an app, it registers its skills with the Grafana
  Assistant instead of leaving them to be pasted: panel SQL, dashboard JSON, and a new one for the
  Mosaic panel (its options, specs over datasets, writing and reading variables, kepler maps). Two
  starters on a fresh chat. See docs/grafana-assistant.md.

## 2.0.0 (2026-10-23)

- **Chaski is an app.** The plugin is now `ubica-chaski-app`, which brings the datasource under its
  same id, `ubica-chaski-datasource`, so dashboards and provisioned datasources keep working. Install
  the app's folder as `ubica-chaski-app/` and remove an old `ubica-chaski-datasource/` folder first:
  Grafana refuses a plugin id it already registered. Unsigned builds must allow
  `ubica-chaski-app,ubica-chaski-datasource,ubica-chaski-mosaic-panel`. The app enables itself.
- **Mosaic panel.** `ubica-chaski-mosaic-panel` draws a [Mosaic](https://idl.uw.edu/mosaic/) spec
  (YAML or JSON) over the dashboard's datasets on Chaski's engine. Panels sharing a selection filter
  each other in the browser, pre-aggregated for large tables, and a selection can write dashboard
  variables in the shapes cross-filters read. See docs/mosaic.md.
- **Examples.** `examples/dashboards/` holds a gallery for Grafana 13: five of Mosaic's examples in
  tabs, each driving Grafana stat panels and tables through cross-filters, one on the live USGS feed.
  Pacha syncs the folder with Git Sync. A second dashboard, `mosaic-density`, holds Mosaic's density
  visualizations (penguins, flights, stocks) with brushes that drive stat panels.
- **Read from variables.** The Mosaic panel turns dashboard variables written elsewhere into clauses
  of its selections: a range from one or two variables, a WKT area over longitude and latitude, or a
  list of values. A kepler map's viewport and drawn area now drive Mosaic. A third example,
  `mosaic-nyc-taxi`, has Mosaic and kepler driving each other over a million taxi rides.
- **Gaia example.** `mosaic-gaia`: the Milky Way and a Hertzsprung–Russell diagram from 5 million stars
  in the browser, with brushes that drive stat panels.
- The Mosaic panel: a 2-D brush can write one range per axis (`from` and `to` as lists), for axes that
  are not longitude and latitude; an error after the panel has drawn shows over it until a later query
  answers; and a brush that leaves a contour or heatmap no rows no longer freezes the dashboard's
  Mosaic panels (a fix to Mosaic 0.34).

## 1.2.0 (2026-10-23)

- **Cross-filters.** A filters variable (kind `filters`) declares a dataset's filters: range, in,
  equals, search, a drawn area, or a link to another dataset's filters. Panels apply them with
  `$__crossfilter($quakeFilters, -own)`, every active filter but the panel's own, and run again
  whenever one changes; `$__filters($quakeFilters)` lists them for a filter bar. Values are parsed
  and quoted by the plugin, never pasted into the SQL. See the plugin's README.
- The development build no longer lints files as they change: `eslint-webpack-plugin` is gone from
  the build and its dependencies. It brought in `braces`, whose every release carries a high
  advisory with no fix (CVE-2026-93687), which the plugin validator reports and no longer lets
  `osv-scanner.toml` excuse. It never ran in the production build; linting stays with `npm run lint`.

## 1.1.0 (2026-10-07)

- **Grafana Assistant.** On a Grafana with the Assistant, a Chaski dashboard tells it which datasets
  are loaded in the browser: their `$name`, rows, freshness, columns with DuckDB types, and the time
  range, plus two starter questions. Nothing is registered without the Assistant. Two skill texts,
  `chaskiAssistantSkill` and `dashboardAuthoringSkill`, teach it Chaski's SQL and dataset variables;
  see docs/grafana-assistant.md.

## 1.0.0 (2026-09-23)

Initial release.

- A dataset that reloads on time-range change keeps its table when the new range fits inside the
  loaded one (a zoom-in, or presets that end at `now`). Refreshing still reloads.
  Such a dataset must return plain rows for its range, and the panels reading it must filter by time
  themselves (`$__timeFilter`); a dataset that can't should refresh on dashboard load instead.
- The datasource announces when it starts and finishes answering queries (`ubica-duckdbwasm-activity`
  on Grafana's app event bus), for panels that pace themselves on it.
- A panel query that runs again with new variable values reuses the columns it found last time instead
  of asking DuckDB for them first, one worker round trip less per query. The result must show the
  columns still hold, or the query is described and run again as before.
- Identical requests for a panel that are in flight at once share one execution. Grafana sends a
  panel's request twice when two variables change together (kepler's time window), and both used to
  run in full. Nothing is cached once the execution ends.
- Files on servers without CORS, or behind credentials, load through Grafana's data proxy with
  `$__proxy('path')`. Credentials (basic auth, headers, an API key in the URL) stay encrypted on the
  server. The plugin now declares data proxy routes, so Grafana must be restarted after upgrading.
- Other plugins can run on the datasource's engine through `window.__chaski` (API version 1):
  Arrow IPC results, a `datasets` schema with a view per dataset, and an `explore` scratch schema
  that empties on every dashboard change. See "API for other plugins" in the README.
- The engine starts where Grafana serves plugin files from a CDN on another origin, as Grafana Cloud
  does. A browser won't run a worker script from another origin, so there the worker starts from a
  `blob:` that imports it. Self-hosted installs keep the plain worker.
