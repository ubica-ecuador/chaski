# Chaski

A Grafana datasource that loads a dashboard's data **once** into DuckDB running in the browser, and
answers every panel query there. It is named after the runners who carried word along the Andean
roads: the data is already here, so the answer is immediate. Changing a variable, an ad hoc filter or
the time range re-queries the browser, not the server. Filters take milliseconds, and every panel
keeps working: native, catalog and the kepler map.

- **Plugin id:** `ubica-chaski-datasource`. Frontend only: no backend, no alerting.
- **Engine:** DuckDB 1.4.3 through `@duckdb/duckdb-wasm` 1.32.0, running in a Web Worker.
- **Distribution:** git only, unsigned. It ships in the self-hosted Grafana Geospatial Stack and is not
  published in the Grafana catalog.
- **For dashboard authors:** how to write datasets and panel SQL is in [src/README.md](src/README.md). That
  file is the page Grafana shows for the plugin. For a worked example, follow
  [docs/tutorial-earthquakes.md](docs/tutorial-earthquakes.md), which builds a dashboard from a live
  feed three ways: read in the browser, fetched by another datasource, and through the data proxy.

## How it works

- **Datasets.** A dataset is a hidden query variable of this datasource. It loads into a versioned
  DuckDB table when the dashboard opens, or on a time-range change if its refresh says so. Panels read it
  by name (`FROM $vehicles`). Its rows come from one of two places:
  - another Grafana datasource (server DuckDB, Postgres, Infinity…), through that datasource's own query
    path;
  - SQL in the browser (`read_parquet`/`read_csv`/`read_json` on a URL that allows CORS, or a `SELECT`
    over another dataset).
- **Files behind Grafana's data proxy.** A server without CORS headers, or one that wants a secret,
  is read through Grafana instead: `$__proxy('path')` builds a URL under
  `/api/datasources/proxy/uid/<uid>/`, and Grafana adds the credentials the datasource stores
  encrypted (basic auth, headers, or a key in the query string). The plugin declares GET and HEAD
  routes for it, so query permission never turns into write access to that server.
- **Range reuse.** A dataset that reloads on time-range change keeps its table when the new range fits
  inside the loaded one, within the same visit to the dashboard, and nothing else in its source changed.
  Refreshing always reloads. The rules this puts on authors are in [src/README.md](src/README.md).
- **Panel queries.** Panel SQL runs locally with the server DuckDB datasource's quoting and macros.
  Around that:
  - each query's column list is remembered, so repeat runs skip the `DESCRIBE`;
  - identical in-flight requests for a panel share one execution;
  - ad hoc filters apply locally.
- **Activity.** The datasource publishes `ubica-duckdbwasm-activity` (`busy`/`settled`) on Grafana's app
  event bus. The kepler panel uses it to pace its playback. The event keeps its old name on purpose:
  the published panel matches it as a string, so renaming it would break playback pacing for anyone
  on the current version.

`window.__duckdbwasm.stats` records every load, reuse, panel answer, shared request and activity
transition on the page. The e2e suite and the bench read it, and it is handy when debugging a dashboard.

## API for other plugins

Other plugins on the page can use Chaski's engine instead of starting their own DuckDB. The SQLRooms
explorer and the kepler map do. They find it at runtime; nothing imports Chaski's code.

```ts
const chaski = (window as any).__chaski; // undefined when Chaski is not installed
const api = await chaski?.engine(); // undefined until a Chaski query has started the engine
```

`apiVersion` is `1`. Additive changes keep it; a breaking change adds `window.__chaski.v2` beside it
for at least one release.

- **`queryIPC(sql, { signal, consumer })`** runs one statement and returns an Arrow IPC stream
  (`Uint8Array`). Decode it with your own apache-arrow: `Table` objects cannot cross bundles, and the
  IPC format is stable across apache-arrow versions.
- **`exec(sql, opts)`** runs statements whose result nobody reads.
- **`consumer`:**
  - `'explorer'` (the default) runs on the explorer's own connections and does not count toward
    `ubica-duckdbwasm-activity`;
  - `'panel'` runs on the panels' path and counts, which is what a panel reading data should use.
- **`datasets()`** lists the dashboard's datasets: name, view, current table, rows, and `stale`
  when the latest reload failed.
- **`onChange(listener)`** reports `{kind: 'dataset'}` once a dataset's view reads a new version, and
  `{kind: 'dashboard'}` once another dashboard is on screen.
- **`releaseScratch()`** empties `explore`.

Two schemas go with it:

- **`datasets`:** one view per dataset of the dashboard on screen, e.g. `datasets."sample"`, always on
  the current version. Panel SQL says `$sample` where explorer SQL says `datasets.sample`.
- **`explore`:** scratch space. On explorer connections, unqualified writes land here, and `FROM
sample` finds the dataset. It is emptied when the explorer calls `releaseScratch()` (it should on
  open and on close) and whenever another dashboard comes on screen. Never rely on a table in it
  staying around.

Nothing stops an explicit write to `main`, where the panels' tables live: DuckDB has no
per-connection permissions. Don't. A dropped dataset table breaks its panels until the next refresh.
Scratch tables also share the datasource's memory limit with the datasets.

## Requirements

- **Grafana 12.0.0 or later** (`grafanaDependency` in `src/plugin.json`). It is tested on 12.0.10
  and 13.2.2.
- **Unsigned plugin:** Grafana must allow loading it, with
  `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=ubica-chaski-datasource`.
- **Browser memory.** Each viewer's browser holds the datasets. The limit is a datasource setting
  (`memoryLimitMB`, 1024 by default). Aggregate on the server, and let only the working set reach the
  browser.
- **Content Security Policy.**
  - The engine starts under Grafana's stock policy with nothing extra to allow.
  - A browser-side read of another host needs that host to send CORS headers. If CSP is on, the host
    also has to be in `connect-src`. Otherwise read it through the data proxy (`$__proxy`), which is
    same-origin, or through a server datasource.

## Install (self-hosted)

1. Build it: `npm ci && npm run build`. This writes `dist/`, including the DuckDB worker, the wasm and
   the extensions.
2. Put `dist/` in Grafana's plugin directory as `ubica-chaski-datasource/`, either copied or mounted.
3. Allow the unsigned plugin (see Requirements) and restart Grafana. Changes to `src/plugin.json` also
   need a restart; a rebuilt `dist/` is picked up on the next page load.
4. Provision the datasource, as in [provisioning/datasources/datasources.yml](provisioning/datasources/datasources.yml):

   ```yaml
   apiVersion: 1
   datasources:
     - name: 'Chaski'
       uid: 'duckdbwasm'
       type: 'ubica-chaski-datasource'
       access: proxy
       jsonData:
         memoryLimitMB: 1024
   ```

## Develop

You need Node 22 or later, and Docker for the dev Grafana.

```bash
npm ci
npm run dev        # webpack in watch mode
npm run build      # production build into dist/
npm run server     # dev Grafana on :3005 plus the fixtures server on :8095
```

- `prebuild`/`predev` run `scripts/fetch-duckdb-extensions.mjs`. It downloads `parquet`, `json`,
  `httpfs` and `spatial` for the DuckDB version stated in `src/engine/duckdbVersion.ts`. The plugin serves
  them itself, because it cannot load code from a CDN. When bumping `@duckdb/duckdb-wasm`, bump that
  version too.
- **The dev Grafana** runs **12.0.10** by default, the floor of the supported range. Choose another version
  with `GRAFANA_VERSION=13.2.1 npm run server`. `docker compose --profile csp up` adds a Grafana with the
  stock CSP on **:3006**.
- **The fixtures server** on :8095 serves `fixtures/` with open CORS, the way a public bucket would.
  `scripts/make-fixture.py` regenerates `sample.parquet`.
- Use webpack and the configuration in `.config/`. Don't edit anything under `.config/`; extend it
  instead (`webpack.config.ts`).

### Layout

| Path                | Role                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/engine/`       | The engine. It has no Grafana imports (`@grafana/*` is forbidden there by ESLint). It holds the DuckDB runner, the dataset registry and its visits, the range-reuse rule (`rangeReuse.ts`), panel execution with the schema cache (`executor.ts`, `schemaCache.ts`), `singleFlight.ts`, `activity.ts`, macros and quoting, and `stats.ts`. |
| `src/grafana/`      | The Grafana side: the engine singleton, interpolation, Arrow ⇄ DataFrame conversion, loading from other datasources, dashboard keys and navigation, the data proxy (`proxy.ts`: base URL, routes, error explanations), the activity event, and notices.                                                                                    |
| `src/datasource.ts` | `DataSourceApi`: panel queries, dataset and values variables, ad hoc filter options.                                                                                                                                                                                                                                                       |
| `src/components/`   | The config, query and variable editors.                                                                                                                                                                                                                                                                                                    |
| `tests/`            | End-to-end tests (`@grafana/plugin-e2e`).                                                                                                                                                                                                                                                                                                  |
| `fixtures/`         | What the fixtures server serves: `sample.parquet`, plus three locations that send no CORS headers and want a bearer token, basic auth or a key in the URL — what the data proxy tests read through.                                                                                                                                        |
| `provisioning/`     | The dev Grafana's datasources and dashboards (`e2e`, `e2e-range`, `e2e-proxy`, `bench-1m`). Besides the plain instance it provisions four that read through the data proxy, one per way in plus one with a wrong token.                                                                                                                    |
| `bench/`            | Measurement scripts and bench dashboards (see Bench).                                                                                                                                                                                                                                                                                      |

## Test

```bash
npm run test:ci    # Jest; engine tests run on DuckDB's Node build
npm run typecheck
npm run lint
npm run e2e        # Playwright against the dev Grafana (npm run server first)
```

- The e2e tests default to `http://localhost:3005`. Point them elsewhere with `GRAFANA_URL`.
- Run them on both ends of the supported range: the default 12.0.10, and 13.2.1 with `GRAFANA_VERSION`.
- They cover:
  - loading a dataset and filtering without network requests;
  - ad hoc filters;
  - keeping the last good data when a reload fails;
  - range reuse, including a dataset loaded through another datasource;
  - reading files through the data proxy behind a token, basic auth and a key in the URL, plus the
    messages a rejected credential and a direct read without CORS produce;
  - the engine API: a dataset read by name, a scratch table, and explore emptied on a dashboard change;
  - Save & test.

## Bench

The scripts in `bench/` drive a real Chromium through Playwright and print one JSON report per run.
Results go to `bench/results/`, which git ignores.

| Script                 | Measures                                                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure.mjs`          | Cold and warm load, memory, filter latency, auto-refresh reloads, and range reuse on zoom-in/zoom-out (`--zoom`/`--unzoom`).                                                                                                                         |
| `playback.mjs`         | Whether the panels following kepler's time slider keep up while it plays: the share of publishes answered before the next one, publish-to-answer latency (also per panel), dropped frames and long tasks. It uses hardware GL and a narrowed window. |
| `playbackMetrics.mjs`  | The arithmetic behind `playback.mjs`. Test it with `node --test bench/playbackMetrics.test.mjs`.                                                                                                                                                     |
| `setup-bench.mjs`      | Registers the datasource and uploads the bench dashboards: `bench-1m`, `--with-gtfs`, `--with-earthquakes`.                                                                                                                                          |
| `make-earthquakes.mjs` | Regenerates `earthquakes-local`/`earthquakes-server` from kepler-grafana's `earthquakes` dashboard.                                                                                                                                                  |

`grafana-sources.override.yaml` mounts this plugin into kepler-grafana's :3002 bench. That checkout is
often shared with other work, so check that its `dist/` is the build you mean to measure before you
trust the numbers.

## Changelog and license

- Changes: [CHANGELOG.md](CHANGELOG.md).
- License: Apache-2.0 ([LICENSE](LICENSE)).
