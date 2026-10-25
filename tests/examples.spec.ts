import { expect, test, type Page } from '@grafana/plugin-e2e';
import { readFileSync } from 'node:fs';

// The examples read public data from the network (Mosaic's datasets, the USGS
// feed, Natural Earth) and use Grafana 13's tabs, so they run on request:
// EXAMPLES=1 GRAFANA_VERSION=13.2.4 on the dev Grafana.
test.skip(!process.env.EXAMPLES, 'set EXAMPLES=1 to run the examples against the network');
test.use({ viewport: { width: 1600, height: 1300 } });
// One worker: the dashboards are created once, not by two workers racing.
test.describe.configure({ mode: 'serial' });

const DASHBOARDS = ['mosaic-gallery', 'mosaic-density', 'mosaic-nyc-taxi', 'mosaic-gaia', 'filters-earthquakes'];

test.beforeAll(async ({ request }) => {
  const health = await (await request.get('/api/health')).json();
  test.skip(Number(String(health.version).split('.')[0]) < 13, 'the examples need Grafana 13');
  const url = `/apis/dashboard.grafana.app/v2/namespaces/default/dashboards`;
  for (const uid of DASHBOARDS) {
    const dashboard = JSON.parse(readFileSync(`examples/dashboards/${uid}.json`, 'utf8'));
    const existing = await request.get(`${url}/${uid}`);
    // A Grafana that syncs examples/ with Git Sync (as pacha does) already has it, read-only.
    if (existing.ok() && (await existing.json()).metadata.annotations?.['grafana.app/managedBy'] === 'repo') {
      continue;
    }
    const res = existing.ok()
      ? await request.put(`${url}/${uid}`, {
          data: {
            ...dashboard,
            metadata: { ...dashboard.metadata, resourceVersion: (await existing.json()).metadata.resourceVersion },
          },
        })
      : await request.post(url, { data: dashboard });
    expect(res.ok()).toBe(true);
  }
});

async function open(page: Page, uid: string, datasets: number) {
  await page.goto(`/d/${uid}`);
  await page.waitForFunction(
    (n) => ((window as any).__duckdbwasm?.stats?.loads?.filter((l: any) => l.ok).length ?? 0) >= n,
    datasets,
    { timeout: 120_000 }
  );
}

async function everyTabDraws(page: Page, tabs: string[]) {
  for (const tab of tabs) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByTestId('mosaic-panel').locator('svg').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
    await expect(page.getByTestId('data-testid Panel status error')).toHaveCount(0);
  }
}

const panel = (page: Page, title: string) => page.getByTestId(`data-testid Panel header ${title}`);

/** The biggest drawing in a Mosaic panel: its plot, not a legend swatch. */
async function plotBox(page: Page, title: string) {
  // A tab's panels mount again when it is shown: wait for the drawing.
  await expect(panel(page, title).getByTestId('mosaic-panel').locator('svg').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const boxes = await Promise.all(
    (await panel(page, title).getByTestId('mosaic-panel').locator('svg').all()).map((svg) => svg.boundingBox())
  );
  return boxes.filter((b) => b !== null).sort((a, b) => b!.width * b!.height - a!.width * a!.height)[0]!;
}

async function drag(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  x: number[],
  y: number[]
) {
  await page.mouse.move(box.x + box.width * x[0], box.y + box.height * y[0]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x[1], box.y + box.height * y[1], { steps: 10 });
  await page.mouse.up();
}

test('every tab of the gallery draws, and a brush drives the Grafana cards', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'mosaic-gallery', 6);
  await everyTabDraws(page, ['Flights', 'Seattle weather', 'Athletes', 'Wind', 'Earthquakes, live']);

  await page.getByRole('tab', { name: 'Flights', exact: true }).click();
  const flights = panel(page, 'Flights');
  await expect(flights).toContainText('231');
  await drag(page, await plotBox(page, 'Arrival delay (min)'), [0.45, 0.95], [0.5, 0.5]);
  await expect(page).toHaveURL(/var-f_delay_lo=\d/);
  await expect(flights).not.toContainText('231');
  await expect(panel(page, 'Active filters')).toContainText('Arrival delay');
});

test('every tab of the density dashboard draws, and an empty brush leaves the panels working', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'mosaic-density', 3);
  await everyTabDraws(page, ['Penguins', 'Flights', 'Stocks']);

  await page.getByRole('tab', { name: 'Penguins', exact: true }).click();
  const count = panel(page, 'Penguins');
  await expect(count).toContainText('342');
  const plot = await plotBox(page, 'Flipper and body mass');
  // A box where no penguin is: the contour and density marks get no rows.
  await drag(page, plot, [0.3, 0.42], [0.15, 0.3]);
  await expect(count).toHaveText(/Penguins\s*0$/);
  await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
  // Cleared, and boxed again over the Gentoos: the panels must still follow.
  await page.mouse.click(plot.x + plot.width * 0.8, plot.y + plot.height * 0.8);
  await expect(count).toContainText('342');
  await drag(page, plot, [0.6, 0.95], [0.15, 0.5]);
  await expect(page).toHaveURL(/var-p_flip_lo=2\d\d/);
  await expect(count).not.toContainText('342');
  await expect(count).not.toHaveText(/Penguins\s*0$/);
});

test('the taxi dashboard: Mosaic brushes drive the kepler map and the cards, and the map drives Mosaic', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const kepler = await request.get('/api/plugins/ubica-keplergl-panel/settings');
  test.skip(!kepler.ok(), 'needs the kepler panel (ubica-keplergl-panel)');
  // A million rides, 49 MB, read by the browser.
  await open(page, 'mosaic-nyc-taxi', 1);
  await expect(page.getByTestId('mosaic-panel').locator('svg').first()).toBeVisible({ timeout: 60_000 });
  // The map publishes its view on load; Mosaic and the cards read it.
  await expect(page).toHaveURL(/var-view_w=-7\d/, { timeout: 60_000 });
  await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
  await expect(page.getByTestId('data-testid Panel status error')).toHaveCount(0);

  const trips = panel(page, 'Trips');
  await expect(trips).toContainText('K', { timeout: 60_000 });
  const before = await trips.innerText();
  // The hour histogram has drawn its bars, so its brush is live.
  await expect(panel(page, 'Pickup hour').getByTestId('mosaic-panel').locator('svg rect').nth(10)).toBeAttached({
    timeout: 60_000,
  });
  await drag(page, await plotBox(page, 'Pickup hour'), [0.15, 0.3], [0.5, 0.5]);
  await expect(page).toHaveURL(/var-t_hour_lo=\d/);
  await expect(trips).not.toHaveText(before, { timeout: 60_000 });
  await expect(panel(page, 'Active filters')).toContainText('Hour');
});

test('Gaia: 5 million stars load, and the nearby ones sharpen the HR diagram', async ({ page }) => {
  test.setTimeout(300_000);
  // About 100 MB, read by the browser.
  await open(page, 'mosaic-gaia', 1);
  const stars = panel(page, 'Stars');
  await expect(stars).toContainText('3.71', { timeout: 120_000 });
  await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
  await expect(page.getByTestId('data-testid Panel status error')).toHaveCount(0);
  await expect(panel(page, 'Parallax (mas)').getByTestId('mosaic-panel').locator('svg rect').nth(10)).toBeAttached({
    timeout: 60_000,
  });
  await drag(page, await plotBox(page, 'Parallax (mas)'), [0.45, 0.97], [0.5, 0.5]);
  await expect(page).toHaveURL(/var-g_par_lo=\d/);
  await expect(stars).not.toContainText('3.71', { timeout: 120_000 });
  await expect(panel(page, 'Active filters')).toContainText('Parallax');
});

test('the filters example: play slides the timeline, and the sidebar and the cards follow it', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'filters-earthquakes', 1);
  await expect(page.getByTestId('filters-panel')).toHaveCount(2, { timeout: 60_000 });
  const quakes = panel(page, 'Quakes');
  await expect(quakes).toContainText(/\d/);
  const all = await quakes.innerText();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page).toHaveURL(/var-t0=\d{4}-/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(quakes).not.toHaveText(all);
  // The sidebar's time histogram is linked to the timeline: it shows the same window, with its ×.
  await expect(panel(page, 'Filters').getByRole('button', { name: 'Clear Time' })).toBeVisible();
  await expect(page.getByTestId('filters-error')).toHaveCount(0);
  await expect(page.getByTestId('data-testid Panel status error')).toHaveCount(0);
});
