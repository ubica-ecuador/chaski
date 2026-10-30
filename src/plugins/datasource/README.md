# Chaski – powered by DuckDB

The datasource of the [Chaski](https://github.com/ubica-ecuador/chaski) app. It runs DuckDB in the
browser: a dashboard's data loads **once**, and every panel query is answered locally. Changing a
variable, an ad hoc filter or the time range re-queries the browser, not the server, and every panel
(native, catalog, kepler) keeps working.

## In short

- A **dataset** is a hidden query variable of this datasource (kind _Dataset_). Its rows come from
  another datasource (the server DuckDB, Postgres, Infinity…), where its query runs with the
  dashboard's time range and variables, or from SQL in the browser over a URL that allows CORS.
- Panels read a dataset by name:

      SELECT route, count(*) FROM $vehicles WHERE mode IN ($mode) GROUP BY 1

- Variables and the macros `$__timeFilter`, `$__timeFrom`, `$__timeTo` and `$__timeGroup` work as in
  the server DuckDB datasource. `$__crossfilter` and `$__filters` apply the cross-filters declared
  by a filters variable; `$__proxy('path')` reads a file through Grafana's data proxy, with the
  credentials set on this datasource.
- Each viewer's browser holds the datasets (1 GB by default, set here). No alerting and no
  server-side rendering of queries.

The full guide (datasets, SQL, cross-filters, the proxy, limits) is the app's page, in this Grafana
under **Administration › Plugins and data › Plugins › Chaski**, and in the repository:
[src/README.md](https://github.com/ubica-ecuador/chaski/blob/main/src/README.md). A worked example
from a live feed to a map:
[docs/tutorial-earthquakes.md](https://github.com/ubica-ecuador/chaski/blob/main/docs/tutorial-earthquakes.md).

## Trademarks

Chaski is an independent project, not affiliated with or endorsed by the DuckDB Foundation. DuckDB is a
trademark of the DuckDB Foundation.
