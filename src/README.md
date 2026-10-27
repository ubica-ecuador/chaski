# Chaski

Named after the runners who carried word along the Andean roads: the data is already here, so the
answer is immediate. Chaski loads a dashboard's data **once** into DuckDB running in the browser, and
answers every panel query locally. Changing a variable, an ad hoc filter or the time range re-queries
the browser, not the server: filters take milliseconds, and every panel (native, catalog, kepler)
keeps working.

A worked example, from a live feed to a map, is in the repository:
[docs/tutorial-earthquakes.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/tutorial-earthquakes.md).

Live demos: [the dashboards tagged `chaski`](https://pacha.ubica.dev/dashboards?tag=chaski) on
pacha.ubica.dev, open with no account. They run on [Pacha](https://github.com/ubica-ecuador/pacha),
an open spatio-temporal stack for Grafana that includes Chaski, with DuckDB on the server and the
kepler map panel: one command brings it up with these dashboards.

[![A drone flight replayed on a map beside a Mosaic panel of its height, speed, power and voltage; the box brushed on the charts is a window of the flight](https://docs.ubica.dev/img/plus/drone-flights.jpg)](https://pacha.ubica.dev/d/drone-delivery-flights)

**Delivery drone flights.** Every second of 209 flights loads once into the browser. The Mosaic panel
draws height, speed, power and voltage from it, and its brushes filter the other panels in the
browser, with no query to the server.

[![A fire archive since 2000: an A5 grid of detections on the map, countries ranked, a Mosaic fire calendar and a time brush over the monthly bars](https://docs.ubica.dev/img/plus/time-brush.jpg)](https://pacha.ubica.dev/d/firms-fire-archive)

**Active fires since 2000.** 634 million satellite detections reach the browser once, as about 5 MB of
aggregates per cell and month. The map, the ranking, the counts and the Mosaic calendar all read it, and
follow the window as it is brushed or played.

[![NO2 in Amsterdam: a surface between the stations with each station's last 24 hours, the stations ranked, and a time brush over the hours](https://docs.ubica.dev/img/plus/air-quality-amsterdam.jpg)](https://pacha.ubica.dev/d/air-quality-amsterdam)

**Air quality in Amsterdam.** The hourly readings of 17 stations answer every panel in the browser:
moving the hours re-draws the map, the cards and the ranking at once, with no round trip.

[![A GPS truck followed in 3D through a city, and its whole road drawn as a curtain coloured by speed, with its stops](https://docs.ubica.dev/img/plus/gps-truck.jpg)](https://pacha.ubica.dev/d/gps-truck-track-plus)

**A GPS truck track.** One trip's fixes feed two maps, six cards and three Mosaic charts below them,
all from the same dataset in the browser.

## Datasets

A dataset is a hidden **query variable** of this datasource (kind _Dataset_). It loads when the
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

A dataset that can't follow both should load with the dashboard instead (refresh _On dashboard load_).

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

On a map with many rows, ask for GeoJSON instead — `SELECT ST_AsGeoJSON(geom) AS geom` — and the
panel skips decoding the hex itself. DuckDB does that work in WebAssembly, which measured 3 to 5
times cheaper than the panel's JavaScript: about 0.2 s against 1.0 s for 200k points, and 0.3 s
against 1.1 s for 20k polygons of 24 vertices. The text is a little larger than the hex, but it
never leaves the browser. Here `ST_AsGeoJSON` already returns text; on the server DuckDB datasource
the same call needs a `::VARCHAR` cast.

`$__proxy('path')` reads a file through Grafana's data proxy (below).

## Cross-filters

Panels that filter each other (a brush, a map's drawn area, a picked value) write dashboard
variables, and every other panel reads them. Instead of repeating those conditions in each query, a
**filters variable** declares them once for a dataset, and a panel asks for them with
`$__crossfilter($quakeFilters, -own)`: the `AND` of the active filters, leaving out the panel's own,
the one whose variables it writes. A panel that read its own filter could never widen again.

The filters variable is a hidden query variable of this datasource, of kind `filters`. It names its
dataset and every variable it reads as `$name`: that is how Grafana knows to refresh it when one of
them changes. Its value then changes too, and Grafana runs again every panel that names it.

```json
{
  "name": "quakeFilters",
  "type": "query",
  "hide": 2,
  "skipUrlSync": true,
  "refresh": 1,
  "datasource": { "type": "ubica-chaski-datasource", "uid": "<chaski uid>" },
  "query": {
    "refId": "quakeFilters",
    "kind": "filters",
    "dataset": "$quakes",
    "filters": [
      { "name": "time", "type": "range", "column": "time", "as": "time", "from": "$t0", "to": "$t1" },
      { "name": "mag", "type": "range", "column": "mag", "from": "$mag_lo", "to": "$mag_hi", "label": "Magnitude" },
      { "name": "area", "type": "area", "variable": "$area", "lat": "latitude", "lng": "longitude" },
      { "name": "alert", "type": "in", "column": "alert", "variable": "$alerts" }
    ]
  }
}
```

```sql
SELECT floor(mag / 0.5) * 0.5 AS bin, count(*) AS n
FROM $quakes
WHERE $__timeFilter(time) AND $__crossfilter($quakeFilters, -mag)
GROUP BY 1 ORDER BY 1
```

| Type     | Keys                                                                                              | Condition                                                          | Off while                                                 |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `range`  | `column`, `from`, `to`; `as`: `number` (default) or `time`; `upper`: `open` (default) or `closed` | `column >= from AND column < to`                                   | both variables are empty; one empty leaves that side open |
| `in`     | `column`, `variable` (multi-value)                                                                | `column IN (…)`                                                    | empty, or All                                             |
| `equals` | `column`, `variable`                                                                              | `column = value`                                                   | empty                                                     |
| `search` | `column`, `variable`                                                                              | case-insensitive substring                                         | empty                                                     |
| `area`   | `variable` (WKT polygon, as kepler writes it), `lat`, `lng`                                       | point in polygon, behind a bounding box; no `spatial` needed       | empty                                                     |
| `link`   | `column`, `filters` (another dataset's filters variable), `to`                                    | `column IN (SELECT to FROM that dataset WHERE its active filters)` | the other dataset has none active                         |

- `$__crossfilter($quakeFilters AS q)` prefixes the columns with `q.`. Columns are names, not
  expressions: compute a derived column in the dataset.
- The result is always a parenthesised condition, `(TRUE)` when nothing is active.
- Values never reach the SQL as text: numbers and times are parsed and printed back, strings are
  quoted. A value that doesn't parse turns its filter, or that end of a range, off. Times are
  compared as UTC ISO strings, which DuckDB casts to the column's type; a time with no zone is UTC.
- The macros take the filters variable, never the dataset: a query that named only `$quakes` would
  not run again when a filter changes. An unknown filter name or variable fails the panel with a
  message saying which.
- `SELECT * FROM $__filters($quakeFilters)` lists the declared filters, one row each: `name`,
  `label`, `active`, `value` (as a reader would write it, such as `4.5 – 6`) and `variables` (the
  ones to empty to clear it, comma-separated). It feeds a filter bar.
- These macros are Chaski's own: the server DuckDB datasource doesn't have them.

Identical requests for a panel that are in flight at once share one execution. A query reading the
clock (`now()`), random numbers or a URL may therefore get the answer of an identical request that
started moments earlier.

## Activity

The datasource says on Grafana's app event bus when it starts answering queries and when it has none
left. The event has type `ubica-duckdbwasm-activity` and payload `{ state: 'busy' | 'settled', at,
pending }`, and it is sent only on those two transitions. The kepler panel uses it to publish its next
playback step only once the panels reading the previous one have answered. A panel that wants it
declares its own event class with the same `type` string; there is nothing to import.

## Files behind the proxy

Some files can't be read from the browser: the server sends no CORS headers, or it wants a secret the
viewer mustn't see. Grafana's data proxy reads them instead. Set a **URL** in this datasource's
settings, plus whichever credentials the server takes:

- **Basic auth**: a user and a password.
- **Headers**: such as `Authorization: Bearer …` or `X-API-Key: …`.
- **API key in the URL**: the parameter name (such as `apikey`) and the key.

Then give `$__proxy` the path under that URL:

    SELECT * FROM read_parquet($__proxy('cuenca/vias.parquet'))
    SELECT * FROM read_parquet($__proxy('zonas/' || $region || '.parquet'))

The browser asks Grafana, on Grafana's own origin. Grafana adds the credentials and forwards the
request, and the file comes back as the server sent it. The secrets stay encrypted on the server.

- One server per datasource instance. For another server, add another instance: all instances share
  the browser's DuckDB, so their datasets meet in SQL.
- Every byte passes through Grafana, and Grafana does not cut off a slow download.
- The proxy can't sign requests. For a private S3 bucket, use presigned URLs directly instead.
- Public files that allow CORS are faster read directly, without `$__proxy`.
- The credentials reach the whole server, not just the path given to `$__proxy`: that path is a
  starting point, not a sandbox, and it can be climbed out of with `%2e%2e%2f`. Anyone who may query
  this datasource can read anywhere on that server.

## Grafana Assistant

On a Grafana with the Grafana Assistant, the Assistant is told which datasets this dashboard loaded,
with their columns and types, so it can write panel SQL over them. It cannot run Chaski queries
itself. The app registers skills that teach it Chaski's SQL, its dataset variables and the Mosaic
panel; their texts are in
[docs/grafana-assistant.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/grafana-assistant.md).

## Filters panel

The app brings **Chaski Filters**, a panel that shows a dataset's cross-filters and sets them, with no
query to write: how many rows they leave, and a control for each drawn by Mosaic, counted under the
others and following each other live as a brush moves. Values to
pick for `in` and `equals`, a histogram to brush for `range`, a text box for `search`; a map's area
shows as set, with a ×. It writes the same variables the filters read, so every panel follows it. Tall,
it is a sidebar; low, a strip of pills. See
[docs/filters.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/filters.md), and
[a live example](https://pacha.ubica.dev/d/filters-earthquakes) that plays a month of earthquakes on a map.

## Mosaic panel

The app also brings **Chaski Mosaic**, a panel that draws a
[Mosaic](https://idl.uw.edu/mosaic/) spec (YAML or JSON) over this dashboard's datasets, by name.
Panels that share a selection filter each other in the browser, and Mosaic pre-aggregates what a
brush reads, so it keeps up on millions of rows. A selection can write dashboard variables once the
brush rests: interval ends, picked values, or a 2-D brush as a WKT polygon, in the shapes the filters
above read, so every Chaski panel and the kepler map follow it. How to write one:
[docs/mosaic.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/mosaic.md).

## Limits

- Memory: each viewer's browser holds the datasets. The limit is set on the datasource (1 GB by default).
- No alerting and no server-side rendering of queries: everything runs in the browser.
- Content Security Policy: works with Grafana's stock policy (measured on Grafana 12.0.10) and with
  Grafana Cloud's; nothing extra to allow. A custom policy that sets `worker-src` must allow `blob:`
  where plugin files come from a CDN, as on Grafana Cloud.

## Trademarks

Chaski is an independent project, not affiliated with or endorsed by the DuckDB Foundation. DuckDB is a
trademark of the DuckDB Foundation.
