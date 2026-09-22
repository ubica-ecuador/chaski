// Phase 0 and acceptance measurements. Opens a dashboard in a fresh browser and
// prints one JSON report. It counts panel answers in one of two ways:
//   default   the queries this plugin records in window.__duckdbwasm.stats;
//   --server  /api/ds/query responses whose x-panel-id is in --panel-ids, for a
//             dashboard on a server datasource.
//
//   node bench/measure.mjs --url http://localhost:3005 --uid duckdbwasm-bench-1m --panels 3 \
//     --var cat --from 0,1,2 --to 7,8 [--changed 3] [--dataset synthetic --refresh 10s] \
//     [--server --panel-ids 5,8,11,12] [--auth user:pass]
//
// --changed: panel answers expected after the variable moves (default --panels).
// Panels that don't use the variable are not re-run. The viewport is 4000 px
// tall because Grafana only queries panels in view.
// --zoom/--unzoom from,to (epoch ms): move the time range in place and count dataset loads and reuses.
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string' },
    uid: { type: 'string' },
    panels: { type: 'string' },
    changed: { type: 'string' },
    var: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    dataset: { type: 'string' },
    refresh: { type: 'string' },
    auth: { type: 'string' },
    server: { type: 'boolean' },
    'panel-ids': { type: 'string' },
    zoom: { type: 'string' },
    unzoom: { type: 'string' },
  },
});
const base = opt.url.replace(/\/$/, '');
const panels = Number(opt.panels);
const changed = Number(opt.changed ?? opt.panels);
const httpCredentials = opt.auth
  ? { username: opt.auth.split(':')[0], password: opt.auth.split(':').slice(1).join(':') }
  : undefined;

const dashboardUrl = (values, extra = '') => {
  const vars =
    opt.var && values
      ? values
          .split(',')
          .map((v) => `&var-${opt.var}=${encodeURIComponent(v)}`)
          .join('')
      : '';
  return `${base}/d/${opt.uid}?orgId=1${vars}${extra}`;
};
const readStats = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__duckdbwasm?.stats ?? null)));

const serverAnswers = [];
const answered = (page) =>
  opt.server
    ? Promise.resolve(serverAnswers.length)
    : page.evaluate(() => window.__duckdbwasm?.stats?.queries?.length ?? 0);

async function waitForAnswers(page, count, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while ((await answered(page)) < count) {
    if (Date.now() > deadline) {
      throw new Error(`only ${await answered(page)} of ${count} panel answers`);
    }
    await page.waitForTimeout(100);
  }
}

function watch(page, report) {
  let phase = 'cold';
  const ids = new Set((opt['panel-ids'] ?? '').split(',').filter(Boolean));
  report.assets = { cold: [], warm: [] };
  report.bytes = { cold: 0, warm: 0 };
  report.console = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      report.console.push(msg.text().slice(0, 300));
    }
  });
  page.on('pageerror', (err) => report.console.push(`pageerror: ${err.message.slice(0, 300)}`));
  page.on('response', async (response) => {
    if (!opt.server || !response.url().includes('/api/ds/query')) {
      return;
    }
    const panelId = (await response.request().allHeaders())['x-panel-id'];
    if (panelId && ids.has(panelId)) {
      serverAnswers.push({ panelId, status: response.status(), at: Date.now() });
    }
  });
  page.on('requestfinished', async (request) => {
    const sizes = await request.sizes().catch(() => undefined);
    report.bytes[phase] += sizes?.responseBodySize ?? 0;
    const url = request.url();
    if (!/duckdb/.test(url)) {
      return;
    }
    const response = await request.response();
    const headers = (await response?.allHeaders()) ?? {};
    report.assets[phase].push({
      url: url.replace(base, ''),
      status: response?.status(),
      encoding: headers['content-encoding'] ?? 'none',
      bodyBytes: sizes?.responseBodySize,
    });
  });
  return { setPhase: (p) => (phase = p) };
}

const report = { url: base, uid: opt.uid, mode: opt.server ? 'server' : 'browser', at: new Date().toISOString() };
const browser = await chromium.launch();
let page;
try {
  const context = await browser.newContext({ httpCredentials, viewport: { width: 1600, height: 4000 } });
  page = await context.newPage();
  const watcher = watch(page, report);

  // 1. Cold: nothing cached.
  const coldStart = Date.now();
  await page.goto(dashboardUrl(opt.from));
  await waitForAnswers(page, panels);
  report.cold = { wallMs: Date.now() - coldStart };
  if (!opt.server) {
    const s = await readStats(page);
    Object.assign(report.cold, { engineStartMs: s.engineStartMs, loads: s.loads, queries: s.queries, keys: s.keys });
  }

  // 2. Memory with the data loaded.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  report.memory = { jsHeapUsedBytes: metrics.find((m) => m.name === 'JSHeapUsedSize')?.value };
  if (!opt.server) {
    report.memory.duckdbBytes = await page.evaluate(async () => {
      const t = await window.__duckdbwasm.runner.query(
        'SELECT sum(memory_usage_bytes)::DOUBLE AS b FROM duckdb_memory()'
      );
      return t.get(0).b;
    });
  }

  // 3. Filter latency: move the variable in place (history + popstate, no reload).
  if (opt.var && opt.to) {
    const before = await answered(page);
    const loadsBefore = opt.server ? 0 : (await readStats(page)).loads.length;
    const t0 = Date.now();
    await page.evaluate(
      ({ name, values }) => {
        const url = new URL(window.location.href);
        url.searchParams.delete(`var-${name}`);
        for (const v of values) {
          url.searchParams.append(`var-${name}`, v);
        }
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      { name: opt.var, values: opt.to.split(',') }
    );
    await waitForAnswers(page, before + changed, 60_000);
    report.filter = { wallMs: Date.now() - t0 };
    if (opt.server) {
      report.filter.answers = serverAnswers.slice(before);
    } else {
      const s = await readStats(page);
      report.filter.queries = s.queries.slice(before);
      report.filter.loads = s.loads.slice(loadsBefore);
    }
  }

  // 3b. Range reuse: move the time range in place, then back out past it.
  for (const step of ['zoom', 'unzoom']) {
    if (!opt[step] || opt.server) {
      continue;
    }
    const [from, to] = opt[step].split(',');
    const before = await answered(page);
    const s0 = await readStats(page);
    const t0 = Date.now();
    await page.evaluate(
      ({ from, to }) => {
        const url = new URL(window.location.href);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      { from, to }
    );
    await waitForAnswers(page, before + panels, 60_000);
    const s1 = await readStats(page);
    report[step] = {
      wallMs: Date.now() - t0,
      loads: s1.loads.length - s0.loads.length,
      reuses: s1.reuses.length - s0.reuses.length,
    };
  }

  if (!opt.server) {
    // 4. Warm: same context, so the wasm comes from the HTTP cache (304s).
    watcher.setPhase('warm');
    await page.reload();
    await waitForAnswers(page, panels);
    report.warm = { engineStartMs: (await readStats(page)).engineStartMs };

    // 5. Auto-refresh must reload a `refresh: 2` dataset variable.
    if (opt.refresh && opt.dataset) {
      const second = await context.newPage();
      await second.goto(dashboardUrl(opt.from, `&refresh=${opt.refresh}`));
      await waitForAnswers(second, panels);
      await second.waitForTimeout(25_000);
      const s = await readStats(second);
      report.autoRefresh = { loadsOfDataset: s.loads.filter((l) => l.name === opt.dataset).length };
    }
  }
} catch (error) {
  report.error = error.message.split('\n')[0];
  if (!opt.server && page) {
    report.stats = await readStats(page).catch(() => null);
  }
} finally {
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
