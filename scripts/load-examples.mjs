// Loads examples/dashboards/ into a Grafana 13 by its dashboard API, creating
// or replacing each one, for a dev Grafana without Git Sync. Pacha syncs the
// same folder from GitHub instead.
//
//   GRAFANA_URL=http://localhost:3005 node scripts/load-examples.mjs
//
// Admin credentials come from GRAFANA_USER and GRAFANA_PASSWORD (admin:admin).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.GRAFANA_URL ?? 'http://localhost:3005').replace(/\/$/, '');
const auth =
  'Basic ' +
  Buffer.from(`${process.env.GRAFANA_USER ?? 'admin'}:${process.env.GRAFANA_PASSWORD ?? 'admin'}`).toString('base64');
const dir =
  process.env.EXAMPLES_DIR ??
  path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'examples', 'dashboards');

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
  const dashboard = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
  const [group, version] = dashboard.apiVersion.split('/');
  const collection = `/apis/${group}/${version}/namespaces/default/dashboards`;
  const name = dashboard.metadata.name;
  const existing = await call('GET', `${collection}/${name}`);
  const res =
    existing.status === 200
      ? await call('PUT', `${collection}/${name}`, {
          ...dashboard,
          metadata: { ...dashboard.metadata, resourceVersion: existing.json.metadata.resourceVersion },
        })
      : await call('POST', collection, dashboard);
  if (res.status >= 300) {
    console.error(`${file}: HTTP ${res.status}`, res.json?.message ?? '');
    process.exitCode = 1;
  } else {
    console.log(`${file}: ${existing.status === 200 ? 'replaced' : 'created'} /d/${name}`);
  }
}
