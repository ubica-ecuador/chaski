# Changelog

## 1.0.0 (Unreleased)

Initial release.

- A dataset that reloads on time-range change keeps its table when the new range fits inside the
  loaded one (a zoom-in, or presets that end at `now`). Refreshing still reloads.
- The datasource announces when it starts and finishes answering queries (`ubica-duckdbwasm-activity`
  on Grafana's app event bus), for panels that pace themselves on it.
- A panel query that runs again with new variable values reuses the columns it found last time instead
  of asking DuckDB for them first, one worker round trip less per query. The result must show the
  columns still hold, or the query is described and run again as before.
- Identical requests for a panel that are in flight at once share one execution. Grafana sends a
  panel's request twice when two variables change together (kepler's time window), and both used to
  run in full. Nothing is cached once the execution ends.
