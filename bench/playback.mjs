// Plays kepler's time slider on a dashboard and reports whether the panels that
// follow its window keep up. One JSON report per run on stdout.
//
//   node bench/playback.mjs --url http://localhost:3007 --uid earthquakes-local --interval 500 --expected 5
//   node bench/playback.mjs --url http://localhost:3007 --uid earthquakes-server --interval 1500 \
//     --server --panel-ids 1,2,3
//
// --interval     the kepler panel's publishIntervalMs, set through the API before the run.
// --expected     local answers one publish must collect to land: one per target of every
//                panel reading the window (earthquakes: map A, B, C + stat + table = 5, or 10
//                if Grafana's two variable updates each run every dependent panel once).
// --panel-ids    server mode: the panels reading the window; each must answer.
// --var          the variable whose URL changes mark a publish (default quakeFrom).
// --window-days  narrows the dashboard's brush before pressing play, to a window this many days
//                wide inside the feed's last 30 days (default 3): from = now - 20 days, to =
//                from + window-days, both set as var-<var>From/var-<var>To on load. Without this
//                the bench plays a whole-domain window and each publish barely moves it.
import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

import { summarize } from './playbackMetrics.mjs';

const { values: opt } = parseArgs({
  options: {
    url: { type: 'string' },
    uid: { type: 'string' },
    interval: { type: 'string' },
    expected: { type: 'string' },
    seconds: { type: 'string', default: '30' },
    server: { type: 'boolean' },
    'panel-ids': { type: 'string' },
    var: { type: 'string', default: 'quakeFrom' },
    'window-days': { type: 'string', default: '3' },
    auth: { type: 'string' },
  },
});
const base = opt.url.replace(/\/$/, '');
const headers = {
  'content-type': 'application/json',
  ...(opt.auth ? { authorization: `Basic ${Buffer.from(opt.auth).toString('base64')}` } : {}),
};
const httpCredentials = opt.auth
  ? { username: opt.auth.split(':')[0], password: opt.auth.split(':').slice(1).join(':') }
  : undefined;
const panelIds = (opt['panel-ids'] ?? '').split(',').filter(Boolean);
const expected = opt.server ? panelIds.length : Number(opt.expected);
if (!expected) {
  throw new Error('--expected (local) or --panel-ids (server) is required');
}
const seconds = Number(opt.seconds);
const PLAY = '.time-range-slider .playback-control-button';

// The window narrowed onto the dashboard before playback starts: `<var>` drops the trailing
// `From` off --var (so the default `quakeFrom` gives `quake`, and the bounds are `quakeFrom`/
// `quakeTo`), 20 days back from now, --window-days wide.
const windowDays = Number(opt['window-days']);
const varBase = opt.var.replace(/From$/, '');
const windowFrom = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
const windowTo = new Date(windowFrom.getTime() + windowDays * 24 * 60 * 60 * 1000);

// A scratch canvas' WebGL renderer: SwiftShader (software) spends 12-33 s in long tasks per run
// and distorts pacing, so runs are launched with hardware GL and the renderer is reported.
function readGlRenderer() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
}

/** For each publish, how many ok answers landed before the next one (or `end`). */
function answersPerPublish(publishes, answers, end) {
  const ordered = [...answers].sort((a, b) => a.at - b.at);
  return publishes.map((at, i) => {
    const until = i + 1 < publishes.length ? publishes[i + 1] : end;
    return ordered.filter((a) => a.ok && a.at > at && a.at <= until).length;
  });
}

async function setPublishInterval(ms) {
  const got = await fetch(`${base}/api/dashboards/uid/${opt.uid}`, { headers });
  if (!got.ok) {
    throw new Error(`dashboard ${opt.uid}: ${got.status}`);
  }
  const { dashboard } = await got.json();
  const maps = dashboard.panels.filter((panel) => panel.type === 'ubica-keplergl-panel');
  if (maps.length !== 1) {
    throw new Error(`expected one kepler panel, found ${maps.length}`);
  }
  maps[0].options = { ...maps[0].options, publishWhilePlaying: true, publishIntervalMs: ms };
  const saved = await fetch(`${base}/api/dashboards/db`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ dashboard, overwrite: true }),
  });
  if (!saved.ok) {
    throw new Error(`saving ${opt.uid}: ${saved.status} ${await saved.text()}`);
  }
}

// Runs in the page before Grafana does: marks each URL change of the window
// variable as a publish, and keeps frames and long tasks while recording.
function instrument(variable) {
  const bench = { publishes: [], frames: [], longTasks: [], recording: false };
  window.__bench = bench;
  let last = new URL(window.location.href).searchParams.get(`var-${variable}`);
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (state, title, url) => {
      const result = original(state, title, url);
      const now = new URL(window.location.href).searchParams.get(`var-${variable}`);
      if (now !== last) {
        last = now;
        if (bench.recording) {
          bench.publishes.push(Date.now());
        }
      }
      return result;
    };
  }
  const tick = (t) => {
    if (bench.recording) {
      bench.frames.push(t);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new PerformanceObserver((list) => {
    if (bench.recording) {
      for (const entry of list.getEntries()) {
        bench.longTasks.push({ duration: entry.duration });
      }
    }
  }).observe({ type: 'longtask' });
}

const report = {
  url: base,
  uid: opt.uid,
  mode: opt.server ? 'server' : 'browser',
  intervalMs: Number(opt.interval),
  seconds,
  window: { from: windowFrom.toISOString(), to: windowTo.toISOString(), days: windowDays },
  at: new Date().toISOString(),
};
await setPublishInterval(Number(opt.interval));
const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl'] });
try {
  const context = await browser.newContext({ httpCredentials, viewport: { width: 1600, height: 2000 } });
  const page = await context.newPage();
  await page.addInitScript(instrument, opt.var);
  report.glRenderer = await page.evaluate(readGlRenderer);
  const serverAnswers = [];
  page.on('response', async (response) => {
    if (!opt.server || !response.url().includes('/api/ds/query')) {
      return;
    }
    const panelId = (await response.request().allHeaders())['x-panel-id'];
    if (panelId && panelIds.includes(panelId)) {
      serverAnswers.push({ at: Date.now(), key: panelId, ok: response.ok() });
    }
  });

  const windowParams =
    `&var-${varBase}From=${encodeURIComponent(windowFrom.toISOString())}` +
    `&var-${varBase}To=${encodeURIComponent(windowTo.toISOString())}`;
  await page.goto(`${base}/d/${opt.uid}?orgId=1${windowParams}`);
  const play = page.locator(PLAY).first();
  await play.waitFor({ state: 'visible', timeout: 120_000 });
  await page.waitForTimeout(5_000); // the first answers land before the clock starts
  const answersBefore = opt.server
    ? serverAnswers.length
    : await page.evaluate(() => window.__duckdbwasm.stats.queries.length);

  await page.evaluate(() => (window.__bench.recording = true));
  await play.click();
  await page.locator(`${PLAY}.active`).first().waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(seconds * 1000);
  report.playbackRan = await page.locator(`${PLAY}.active`).first().isVisible();
  await page.evaluate(() => (window.__bench.recording = false));
  await page.waitForTimeout(3_000); // answers to the last publish
  const end = Date.now();

  const bench = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bench)));
  let answers;
  if (opt.server) {
    answers = serverAnswers.slice(answersBefore);
  } else {
    const stats = await page.evaluate(() => JSON.parse(JSON.stringify(window.__duckdbwasm.stats)));
    answers = stats.queries.slice(answersBefore).map((q, i) => ({ at: q.at, key: i, ok: q.ok }));
    report.activity = stats.activity.filter((a) => a.at >= bench.publishes[0]);
    report.answersPerPublish = answersPerPublish(bench.publishes, answers, end);
  }
  report.summary = summarize({
    publishes: bench.publishes,
    answers,
    expected,
    end,
    frameTimes: bench.frames,
    longTasks: bench.longTasks,
  });
} catch (error) {
  report.error = error.message.split('\n')[0];
} finally {
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
}
