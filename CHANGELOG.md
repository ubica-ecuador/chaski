# Changelog

## 1.0.0 (Unreleased)

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
