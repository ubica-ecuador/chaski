# DuckDB WASM for Grafana

Loads a dashboard's data **once** into DuckDB running in the browser, and answers every panel query
locally. Changing a variable, an ad hoc filter or the time range re-queries the browser, not the
server: filters take milliseconds, and every panel (native, catalog, kepler) keeps working.

## Datasets

A dataset is a hidden **query variable** of this datasource (kind *Dataset*). It loads when the
dashboard opens, or on every time-range change if its refresh says so. Panels read it by name:

    SELECT route, count(*) FROM $vehicles WHERE mode IN ($mode) GROUP BY 1

A dataset set to reload on time-range change **keeps its table when the new range fits inside the one
it loaded** and nothing else in its source changed. Zooming in on a chart, or moving from "Last 7 days"
to "Last 24 hours", is answered in the browser. Two ranges that both end at `now` count as ending
together when they overlap, so after such a switch the data runs to the last load, not to this second.
A range that starts after the last load, such as "Last 1 hour" picked hours later, reloads. Refreshing
(the button, or auto-refresh) always reloads, and so does a range that reaches outside what was loaded.

After a zoom-in the table still holds the wider range it loaded, so such a dataset comes with two rules:

- its source returns **plain rows for the range**, each with its time: `ORDER BY … LIMIT`, a top-N or
  totals over the whole range turn wrong once the range narrows;
- the **panels reading it filter by time themselves**, for example `WHERE $__timeFilter(t)`, or they
  show rows outside the picked range.

A dataset that can't follow both should load with the dashboard instead (refresh *On dashboard load*).

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

Identical requests for a panel that are in flight at once share one execution. A query reading the
clock (`now()`), random numbers or a URL may therefore get the answer of an identical request that
started moments earlier.

## Activity

The datasource says on Grafana's app event bus when it starts answering queries and when it has none
left. The event has type `ubica-duckdbwasm-activity` and payload `{ state: 'busy' | 'settled', at,
pending }`, and it is sent only on those two transitions. The kepler panel uses it to publish its next
playback step only once the panels reading the previous one have answered. A panel that wants it
declares its own event class with the same `type` string; there is nothing to import.

## Limits

- Memory: each viewer's browser holds the datasets. The limit is set on the datasource (1 GB by default).
- No alerting and no server-side rendering of queries: everything runs in the browser.
- Content Security Policy: works with Grafana's stock policy (measured on Grafana 12.0.10); nothing extra to allow.
