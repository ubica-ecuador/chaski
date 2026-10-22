import { expect, test } from '@grafana/plugin-e2e';

import { setVariable } from './helpers';

test.describe('cross-filters declared on a dataset', () => {
  test('narrow every panel but the one that owns the filter, as the hand-written SQL does', async ({
    gotoDashboardPage,
    page,
  }) => {
    test.setTimeout(120_000);
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e-crossfilter' });
    const rows = dashboard.getPanelByTitle('Rows');
    const byHand = dashboard.getPanelByTitle('Rows, written by hand');
    const byCity = dashboard.getPanelByTitle('By city, all but its own filter');
    const filters = dashboard.getPanelByTitle('Filters');
    await expect(rows.data).toContainText(['1000'], { timeout: 60_000 });
    await expect(byHand.data).toContainText(['1000']);

    await setVariable(page, 'city', ['Quito', 'Loja']);
    // The city table leaves its own filter out, so it still shows the cities that weren't picked.
    await expect(filters.data).toContainText(['Quito, Loja']);
    await expect(byCity.data).toContainText(['Cuenca', 'Guayaquil', 'Loja', 'Manta', 'Quito']);

    await setVariable(page, 'v_lo', ['15']);
    await setVariable(page, 't0', ['2026-01-10T00:00:00Z']);
    await setVariable(page, 'q', ['O']);

    await expect(filters.data).toContainText(['Quito, Loja', '≥ 15', '≥ 2026-01-10', '“O”']);
    const text = async (panel: typeof rows) => (await panel.data.textContent())?.trim();
    await expect.poll(async () => [await text(rows), await text(byHand)].every((t) => t && t !== '1000')).toBe(true);
    await expect.poll(async () => (await text(rows)) === (await text(byHand))).toBe(true);
  });
});
