import { expect, test } from '@grafana/plugin-e2e';
import { readFileSync } from 'node:fs';

// The examples read public data from the network (Mosaic's datasets, the USGS
// feed, Natural Earth) and use Grafana 13's tabs, so they run on request:
// EXAMPLES=1 GRAFANA_VERSION=13.2.4 on the dev Grafana.
test.skip(!process.env.EXAMPLES, 'set EXAMPLES=1 to run the examples against the network');
test.use({ viewport: { width: 1600, height: 1300 } });

const GALLERY = JSON.parse(readFileSync('examples/dashboards/mosaic-gallery.json', 'utf8'));
const TABS = ['Flights', 'Seattle weather', 'Athletes', 'Wind', 'Earthquakes, live'];

test.beforeAll(async ({ request }) => {
  const health = await (await request.get('/api/health')).json();
  test.skip(Number(String(health.version).split('.')[0]) < 13, 'the examples need Grafana 13');
  const url = `/apis/dashboard.grafana.app/v2/namespaces/default/dashboards`;
  const existing = await request.get(`${url}/mosaic-gallery`);
  // A Grafana that syncs examples/ with Git Sync (as pacha does) already has it, read-only.
  if (existing.ok() && (await existing.json()).metadata.annotations?.['grafana.app/managedBy'] === 'repo') {
    return;
  }
  const res = existing.ok()
    ? await request.put(`${url}/mosaic-gallery`, {
        data: {
          ...GALLERY,
          metadata: { ...GALLERY.metadata, resourceVersion: (await existing.json()).metadata.resourceVersion },
        },
      })
    : await request.post(url, { data: GALLERY });
  expect(res.ok()).toBe(true);
});

test('every tab of the gallery draws, and a brush drives the Grafana cards', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/d/mosaic-gallery');
  // Six datasets, read from the network by the browser.
  await page.waitForFunction(
    () => ((window as any).__duckdbwasm?.stats?.loads?.filter((l: any) => l.ok).length ?? 0) >= 6,
    null,
    {
      timeout: 120_000,
    }
  );
  for (const tab of TABS) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByTestId('mosaic-panel').locator('svg').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
    await expect(page.getByTestId('data-testid Panel status error')).toHaveCount(0);
  }

  await page.getByRole('tab', { name: 'Flights' }).click();
  const flights = page.getByTestId('data-testid Panel header Flights');
  await expect(flights).toContainText('231');
  const plot = page
    .getByTestId('data-testid Panel header Arrival delay (min)')
    .getByTestId('mosaic-panel')
    .locator('svg')
    .first();
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page).toHaveURL(/var-f_delay_lo=\d/);
  await expect(flights).not.toContainText('231');
  await expect(page.getByTestId('data-testid Panel header Active filters')).toContainText('Arrival delay');
});
