// Writes the two playback-bench dashboards from kepler's earthquakes dashboard:
//   bench/dashboards/earthquakes-server.json  its queries unchanged, on the server DuckDB;
//   bench/dashboards/earthquakes-local.json   every panel reading one browser dataset.
// Both publish the map's window while playing. Regenerate after the original changes:
//   node bench/make-earthquakes.mjs /home/jag/dev/kepler-grafana/provisioning-sources/dashboards/earthquakes.json
import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2];
if (!source) {
  throw new Error('usage: node bench/make-earthquakes.mjs <path to kepler earthquakes.json>');
}
const original = JSON.parse(await readFile(source, 'utf8'));
const LOCAL = { type: 'ubica-duckdbwasm-datasource', uid: 'duckdbwasm' };
const USGS_CALL = "read_csv_auto('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.csv')";

const copy = () => JSON.parse(JSON.stringify(original));

function publishWhilePlaying(dashboard) {
  for (const panel of dashboard.panels) {
    if (panel.type === 'ubica-keplergl-panel') {
      panel.options = { ...panel.options, publishWhilePlaying: true, publishIntervalMs: 1500 };
    }
  }
}

// The browser engine loads extensions on demand and reads $quakes, so the setup
// statements go, and so do comment lines (one carries $quakeArea, another an
// apostrophe). TIMESTAMP rather than TIMESTAMPTZ: the WASM build ships no ICU.
function toLocal(sql) {
  return sql
    .replace(/\b(INSTALL|LOAD) \w+;\s*/g, '')
    .replace(/SET force_download = true;\s*/g, '')
    .replace(/^\s*--.*$\n?/gm, '')
    .split(USGS_CALL)
    .join('$quakes')
    .replace(/TIMESTAMPTZ/g, 'TIMESTAMP')
    .trim();
}

const server = copy();
server.uid = 'earthquakes-server';
server.title = `${original.title} · bench (server)`;
delete server.id;
publishWhilePlaying(server);

const local = copy();
local.uid = 'earthquakes-local';
local.title = `${original.title} · bench (local)`;
delete local.id;
publishWhilePlaying(local);
local.templating.list.unshift({
  name: 'quakes',
  type: 'query',
  hide: 2,
  skipUrlSync: true,
  refresh: 1,
  datasource: LOCAL,
  query: {
    refId: 'quakes',
    kind: 'dataset',
    name: 'quakes',
    source: {
      type: 'sql',
      sql: `SELECT CAST(time AS TIMESTAMP) AS time, latitude, longitude, depth, mag, place FROM ${USGS_CALL}`,
    },
  },
  current: {},
  options: [],
});
for (const panel of local.panels) {
  if (!panel.targets?.length) {
    continue;
  }
  panel.datasource = LOCAL;
  panel.targets = panel.targets.map((target) => ({ refId: target.refId, datasource: LOCAL, rawSql: toLocal(target.rawSql) }));
}

await writeFile('bench/dashboards/earthquakes-server.json', `${JSON.stringify(server, null, 2)}\n`);
await writeFile('bench/dashboards/earthquakes-local.json', `${JSON.stringify(local, null, 2)}\n`);
console.log('wrote bench/dashboards/earthquakes-{server,local}.json');
