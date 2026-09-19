import { expect, test } from '@grafana/plugin-e2e';

import { answeredQueries, setVariable } from './helpers';

test.describe('a dashboard on the browser engine', () => {
  test('loads the dataset once and filters without touching the network', async ({ gotoDashboardPage, page }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e' });
    const byCity = dashboard.getPanelByTitle('Rows by city');
    await expect(byCity.data).toContainText(['Cuenca', 'Guayaquil', 'Loja', 'Manta', 'Quito'], { timeout: 60_000 });

    const requests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes(':8095/') || url.includes('/api/ds/query')) {
        requests.push(url);
      }
    });
    const before = await answeredQueries(page);
    await setVariable(page, 'city', ['Quito']);
    await expect.poll(() => answeredQueries(page)).toBeGreaterThanOrEqual(before + 2);
    await expect(byCity.data).toContainText(['Quito']);
    await expect(byCity.data).not.toContainText(['Cuenca']);
    expect(requests).toEqual([]);
  });

  test('applies an ad hoc filter locally', async ({ gotoDashboardPage, page }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e' });
    const firstRows = dashboard.getPanelByTitle('First rows');
    await expect(firstRows.data).toContainText(['Guayaquil'], { timeout: 60_000 });
    await setVariable(page, 'Filters', ['city|=|Loja']);
    await expect(firstRows.data).not.toContainText(['Guayaquil']);
    await expect(firstRows.data).toContainText(['Loja']);
  });

  test('keeps the last good data when a reload fails', async ({ gotoDashboardPage, page }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e' });
    const byCity = dashboard.getPanelByTitle('Rows by city');
    await expect(byCity.data).toContainText(['Quito'], { timeout: 60_000 });
    await setVariable(page, 'file', ['missing.parquet']);
    await expect
      .poll(() => page.evaluate(() => (window as any).__duckdbwasm.stats.loads.at(-1)?.ok))
      .toBe(false);
    await expect(byCity.data).toContainText(['Quito']);
  });
});
