# Changelog

## Unreleased

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
  Pacha syncs the folder with Git Sync.

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
