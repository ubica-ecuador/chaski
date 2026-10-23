# Examples

Dashboards that show what Chaski and its Mosaic panel do together. They need **Grafana 13** (they use
dashboard tabs) and the Chaski app, and they read public data from the network in the viewer's
browser.

| Dashboard      | uid              | What it shows                                                                                                                                    |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mosaic gallery | `mosaic-gallery` | Five tabs on [Mosaic's examples](https://idl.uw.edu/mosaic/examples/), each with something only Grafana adds (below). About 3 MB of data in all. |
| Mosaic density | `mosaic-density` | Mosaic's density visualizations in three tabs: penguins, flights and stocks. About 7.5 MB of data.                                               |

**Mosaic gallery**, tab by tab:

- **Flights.** 231 000 flights in three cross-filtered histograms and a density heatmap with contours.
  The brushes write variables that Chaski's `$__crossfilter` reads, so Grafana stat panels (flights,
  on time, mean delay, mean distance) and a list of the active filters follow them.
- **Seattle weather.** Mosaic's interactive weather view; a time brush and a click on a weather type
  drive stat panels, and a monthly temperature band follows the weather you pick.
- **Athletes.** Mosaic's athletes dashboard split across Grafana panels: menus and search on top,
  stat panels, the scatter plot with regression lines, a chart of medals by nation, and the table.
- **Wind.** Mosaic's wind map, with a histogram of speeds that highlights vectors.
- **Earthquakes, live.** A globe of the last 30 days of magnitude 2.5+ earthquakes from the USGS
  real-time feed, over Natural Earth's land, with brushes on magnitude and time driving stat panels
  and a table of the strongest that links to USGS.

**Mosaic density**, tab by tab:

- **Penguins.** Mosaic's contour plot, 2-D density and density groups, all filtered by a new scatter
  of flipper length and body mass: drag a box or click a species in its legend, and the densities and
  the stat panels follow.
- **Flights.** Mosaic's 1-D densities, hexbin with marginal histograms, and heatmap with contours, on
  one cross-filter that drives stat panels.
- **Stocks.** Mosaic's dense lines over 3,600 stocks since 2006, with a stock picked from a menu drawn
  on top (Bank of America and its 2008 fall, to start) and stat panels on the stock you pick.

## Data

All of it is read by the viewer's browser when the dashboard opens; the servers send CORS headers.

- Flights, Seattle weather, athletes, wind, penguins and stocks:
  [Mosaic's example datasets](https://idl.uw.edu/mosaic/data/), from `https://idl.uw.edu/mosaic/data/`.
- Earthquakes: the [USGS real-time feed](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php),
  public domain.
- Land: [Natural Earth](https://www.naturalearthdata.com/) 1:110m land, public domain.

## See them

- **Git Sync**, as Pacha does: a repository on `examples/dashboards/` of this repo, read-only. In Pacha
  it is the "Chaski plugin" folder.
- **On the dev Grafana**: `GRAFANA_VERSION=13.2.4 npm run server`, then
  `GRAFANA_URL=http://localhost:3005 node scripts/load-examples.mjs`, which creates or replaces each
  dashboard through Grafana's dashboard API.
- **Tests**: `EXAMPLES=1 npm run e2e` against a Grafana 13 runs `tests/examples.spec.ts`. It is opt-in
  because it needs the network.

## Writing one

- Grafana 13 dashboard JSON (`dashboard.grafana.app/v2`), one file per dashboard, its uid in
  `metadata.name`.
- Datasources by uid only: `duckdbwasm` for Chaski. Only public data with CORS: these dashboards run
  on any Grafana, not just Pacha.
- Variables a Mosaic panel writes are hidden text variables; a `filters` variable declares them for
  Chaski panels, and a table on `$__filters(...)` shows them.
- A 2-D brush on axes that are not longitude and latitude writes one range per axis (`from` and `to`
  as lists): Chaski's `area` filter treats its x as a longitude and wraps it at ±180.
- Give each tab's Mosaic params their own names: params are shared by name across the dashboard.
