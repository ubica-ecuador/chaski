// Real-browser smoke test for the DuckDB-WASM datasource (Task 8, Step 6).
//
// Requires the dev Grafana on :3005 to be up and running this plugin's build:
//   npm run build && docker compose restart grafana
//
// Run: node scripts/smoke.cjs
// Prints one JSON object with every measurement, and exits non-zero if any
// check fails.
const { chromium } = require('@playwright/test');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3005';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const result = { pass: true };

  try {
    // --- Save & test, and the remote Parquet read (parquet + httpfs extensions) ---
    await page.goto(`${BASE_URL}/connections/datasources/edit/duckdbwasm`);
    await page.getByRole('button', { name: /save & test/i }).click();
    await page.getByText(/DuckDB v1\.4\.3 is running in the browser\./).waitFor({ timeout: 60000 });
    result.saveAndTest = 'DuckDB v1.4.3 is running in the browser.';

    result.engineStartMs = await page.evaluate(() => window.__duckdbwasm.stats.engineStartMs);

    result.remoteParquet = await page.evaluate(async () => {
      const r = window.__duckdbwasm.runner;
      try {
        const t = await r.query(
          "SELECT count(*)::DOUBLE AS n FROM read_parquet('https://shell.duckdb.org/data/tpch/0_01/parquet/orders.parquet')"
        );
        return t.get(0).n;
      } catch (e) {
        return 'ERR ' + e.message;
      }
    });

    // --- 3a: spatial + WKB (proves `spatial` autoloads from dist/extensions) ---
    const spatial = await page.evaluate(async () => {
      const r = window.__duckdbwasm.runner;
      const t = await r.query('SELECT ST_AsWKB(ST_Point(1, 2)) AS g');
      const g = t.get(0).g;
      return { numRows: t.numRows, isUint8Array: g instanceof Uint8Array, byteLength: g?.length };
    });
    result.spatial = spatial;
    result.spatialPass = spatial.numRows === 1 && spatial.isUint8Array && spatial.byteLength === 21;

    // --- 3b: real cancellation ---
    const cancel = await page.evaluate(async () => {
      const r = window.__duckdbwasm.runner;
      const controller = new AbortController();
      const promise = r.query('SELECT count(*) FROM range(20000000000) t1', controller.signal);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const abortedAt = performance.now();
      controller.abort();
      try {
        await promise;
        return { rejected: false, message: 'query resolved instead of rejecting' };
      } catch (e) {
        return { rejected: true, elapsedMs: performance.now() - abortedAt, message: e.message };
      }
    });
    result.cancel = cancel;
    result.cancelPass = cancel.rejected && cancel.elapsedMs <= 2000;

    // --- 3c: the real CORS error text (no CORS header on this URL) ---
    const cors = await page.evaluate(async () => {
      const r = window.__duckdbwasm.runner;
      try {
        await r.query("SELECT count(*) FROM read_json('https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json')");
        return { errored: false };
      } catch (e) {
        return { errored: true, message: e.message };
      }
    });
    result.cors = cors;

    result.pass =
      result.remoteParquet === 15000 &&
      result.spatialPass &&
      result.cancelPass &&
      cors.errored;
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
