// Registers the datasource and uploads the bench dashboards into a Grafana that
// already has the plugin mounted. The bench images run anonymous Admin with
// basic auth off, so no credentials are needed; pass --auth user:pass otherwise.
//   node bench/setup-bench.mjs --url http://localhost:3002 --with-gtfs --with-earthquakes
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string' },
    auth: { type: 'string' },
    'with-gtfs': { type: 'boolean' },
    'with-earthquakes': { type: 'boolean' },
  },
});
const base = opt.url.replace(/\/$/, '');
const headers = {
  'content-type': 'application/json',
  ...(opt.auth ? { authorization: `Basic ${Buffer.from(opt.auth).toString('base64')}` } : {}),
};

async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

const existing = await api('GET', '/api/datasources/uid/duckdbwasm');
if (existing.status === 404) {
  const created = await api('POST', '/api/datasources', {
    name: 'DuckDB WASM',
    type: 'ubica-duckdbwasm-datasource',
    uid: 'duckdbwasm',
    access: 'proxy',
    jsonData: { memoryLimitMB: 1024 },
  });
  if (created.status >= 300) {
    throw new Error(`datasource: ${created.status} ${JSON.stringify(created.body)}`);
  }
  console.log('datasource created');
} else if (existing.status !== 200) {
  throw new Error(`datasource lookup: ${existing.status} ${JSON.stringify(existing.body)}`);
} else {
  console.log('datasource already there');
}

const files = [
  'provisioning/dashboards/bench-1m.json',
  ...(opt['with-gtfs'] ? ['bench/dashboards/gtfs-rt-mbta-local.json'] : []),
  ...(opt['with-earthquakes']
    ? ['bench/dashboards/earthquakes-local.json', 'bench/dashboards/earthquakes-server.json']
    : []),
];
for (const file of files) {
  const dashboard = JSON.parse(await readFile(file, 'utf8'));
  delete dashboard.id;
  const saved = await api('POST', '/api/dashboards/db', { dashboard, overwrite: true });
  if (saved.status >= 300) {
    throw new Error(`${file}: ${saved.status} ${JSON.stringify(saved.body)}`);
  }
  console.log(`${file} → ${saved.body.url}`);
}
