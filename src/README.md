# DuckDB WASM for Grafana

Loads a dashboard's data **once** into DuckDB running in the browser, and answers every panel query
locally. Changing a variable, an ad hoc filter or the time range re-queries the browser, not the
server: filters take milliseconds, and every panel (native, catalog, kepler) keeps working.

## Datasets

A dataset is a hidden **query variable** of this datasource (kind *Dataset*). It loads when the
dashboard opens, or on every time-range change if its refresh says so. Panels read it by name:

    SELECT route, count(*) FROM $vehicles WHERE mode IN ($mode) GROUP BY 1

Rows come from:

- **another datasource**, for example the server DuckDB, Postgres or Infinity. Its query runs on the
  server with the dashboard's time range and variables. Use this for private data, APIs without
  CORS, and anything big: aggregate there and let only the working set reach the browser;
- **SQL in the browser**: `read_parquet`, `read_csv` or `read_json` on a URL that allows CORS, or a
  `SELECT` over another dataset.

If a reload fails, panels keep the last good data and say how old it is.

## SQL

Variables are quoted exactly as the server DuckDB datasource quotes them (`$x` → `'value'`,
multi-value → `'a','b'`, `${x:raw}` verbatim), and its macros work the same: `$__timeFilter(col)`,
`$__timeFrom()`, `$__timeTo()`. `$__timeGroup(col, 1h)` becomes a `time_bucket`. Geometry columns
reach panels as WKB in hex, which the Kepler panel draws.

## Limits

- Memory: each viewer's browser holds the datasets. The limit is set on the datasource (1 GB by default).
- No alerting and no server-side rendering of queries: everything runs in the browser.
- Content Security Policy: works with Grafana's stock policy (measured on Grafana 12.0.10); nothing extra to allow.
