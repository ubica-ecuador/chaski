import { expect, test } from '@grafana/plugin-e2e';

import { answeredQueries } from './helpers';

/** Rows of a query run on the panels' connection, read back as plain objects. */
async function rows(page: import('@playwright/test').Page, sql: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (sql) => {
    const table = await (window as any).__duckdbwasm.runner.query(sql);
    return table.toArray().map((row: any) => ({ ...row.toJSON() }));
  }, sql);
}

test.describe('the engine API for other plugins', () => {
  test('serves datasets by name, keeps scratch in explore, and empties it on a dashboard change', async ({
    gotoDashboardPage,
    page,
  }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e' });
    await expect(dashboard.getPanelByTitle('Rows by city').data).toContainText(['Quito'], { timeout: 60_000 });

    const first = await page.evaluate(async () => {
      const chaski = (window as any).__chaski;
      const api = await chaski.engine();
      const bytes: Uint8Array = await api.queryIPC('SELECT * FROM sample LIMIT 5');
      await api.exec('CREATE TABLE hot AS SELECT * FROM sample WHERE v > 20');
      return { apiVersion: chaski.apiVersion, datasets: api.datasets(), bytes: bytes.byteLength };
    });
    expect(first.apiVersion).toBe(1);
    expect(first.datasets).toEqual([expect.objectContaining({ name: 'sample', view: 'datasets."sample"', rows: 1000 })]);
    expect(first.bytes).toBeGreaterThan(0);
    expect(await rows(page, "SELECT table_name FROM duckdb_tables() WHERE schema_name = 'explore'")).toEqual([
      { table_name: 'hot' },
    ]);
    expect(await rows(page, 'SELECT count(*)::DOUBLE AS n FROM datasets.sample')).toEqual([{ n: 1000 }]);

    // Move to another Chaski dashboard in place: a reload would restart the engine.
    const before = await answeredQueries(page);
    await page.evaluate(() => {
      window.history.pushState({}, '', '/d/duckdbwasm-e2e-range');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect.poll(() => answeredQueries(page), { timeout: 60_000 }).toBeGreaterThan(before);
    await expect
      .poll(() => rows(page, "SELECT count(*)::DOUBLE AS n FROM duckdb_tables() WHERE schema_name = 'explore'"))
      .toEqual([{ n: 0 }]);
    await expect
      .poll(() => rows(page, "SELECT count(*)::DOUBLE AS n FROM duckdb_views() WHERE schema_name = 'datasets' AND view_name = 'sample'"))
      .toEqual([{ n: 0 }]);
  });
});
