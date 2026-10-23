import { expect, test, type Page } from '@grafana/plugin-e2e';

test.use({ viewport: { width: 1600, height: 1300 } });

/** The plots Mosaic draws: a panel's icons (a filter's ×) are SVGs too. */
const PLOTS = 'svg[class^="plot-"]';

/** Clicks the grey bar of a value in a list: the one level with its label. Bars come in data order. */
async function clickValue(plot: ReturnType<Page['locator']>, value: string) {
  const label = (await plot
    .locator('[aria-label="y-axis tick label"] text', { hasText: new RegExp(`^${value}$`) })
    .boundingBox())!;
  const bars = plot.locator('[aria-label="bar"]').first().locator('rect');
  const boxes = await Promise.all((await bars.all()).map((bar) => bar.boundingBox()));
  const mid = label.y + label.height / 2;
  const index = boxes.reduce(
    (best, box, i) =>
      box &&
      Math.abs(box.y + box.height / 2 - mid) < Math.abs((boxes[best]?.y ?? 0) + (boxes[best]?.height ?? 0) / 2 - mid)
        ? i
        : best,
    0
  );
  await bars.nth(index).click({ force: true });
}

/** Drags across a plot from one fraction of its width to another. */
async function drag(page: Page, plot: ReturnType<Page['locator']>, from: number, to: number) {
  // Mosaic draws a plot again on each result: wait for one that is laid out.
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect(async () => {
    box = await plot.boundingBox();
    expect(box).not.toBeNull();
  }).toPass();
  const { x, y, width, height } = box!;
  await page.mouse.move(x + width * from, y + height * 0.4);
  await page.mouse.down();
  await page.mouse.move(x + width * to, y + height * 0.4, { steps: 8 });
  await page.mouse.up();
}

test('the filters panel draws a Mosaic control per filter, counted under the others, and sets and clears them', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const side = dashboardPage.getPanelByTitle('Filters').locator.getByTestId('filters-panel');
  const strip = page.getByTestId('filters-panel').nth(1);
  const count = dashboardPage.getPanelByTitle('Read by Chaski SQL').locator;
  const plots = side.locator(PLOTS);

  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(plots).toHaveCount(5, { timeout: 30_000 });
  await expect(count).toContainText('50000', { timeout: 60_000 });

  // A value: click its bar. The variable is written, every count follows, and the other values stay
  // listed with their counts: a control is counted under every filter but its own.
  const kind = plots.filter({ hasText: 'quarry blast' });
  await expect(kind).toContainText(/42,?927/);
  // A click while Mosaic is still drawing the bars can land on the plot it replaces: try again until it holds.
  await expect(async () => {
    await clickValue(kind, 'explosion');
    await expect(page).toHaveURL(/var-kinds=explosion/, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(side.getByTestId('filters-count')).toHaveText(/^3,535 of/);
  await expect(count).toContainText('3535');
  await expect(kind).toContainText(/42,?927/);
  await expect(strip).toContainText('Kind: explosion');

  // A brush counts live and writes both ends, rounded to the axis, once it rests.
  await drag(page, plots.nth(1), 0.3, 0.6);
  await expect(page).toHaveURL(/var-mag_lo=\d(\.\d{1,2})?&/);
  await expect(page).toHaveURL(/var-mag_hi=\d(\.\d{1,2})?&/);
  await expect(side.getByTestId('filters-count')).not.toHaveText(/^3,535 of/);

  // A search box filters as it is typed.
  await side.getByLabel('Search Place').fill('Zone 1');
  await expect(page).toHaveURL(/var-q=Zone(%20|\+)1/);

  // A chip's × in the other panel clears the brush here too.
  await strip.getByRole('button', { name: 'Clear Magnitude' }).click();
  await expect(page).toHaveURL(/var-mag_lo=&/);
  await expect(side).not.toContainText('Clear Magnitude');

  // Clear all empties every filter's variables.
  await strip.getByRole('button', { name: 'Clear all' }).click();
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes');
  await expect(count).toContainText('50000');
  await expect(page.getByTestId('filters-error')).toHaveCount(0);
});

test('a Mosaic panel on the same selection drives the filters panel', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const side = dashboardPage.getPanelByTitle('Filters').locator.getByTestId('filters-panel');
  const mosaic = dashboardPage.getPanelByTitle('Magnitude (Mosaic)').locator.getByTestId('mosaic-panel').locator('svg');
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(mosaic.first()).toBeVisible();

  // Held, not released: the filters panel follows the brush before any variable is written.
  let box: { x: number; y: number; width: number; height: number } | null = null;
  await expect(async () => {
    box = await mosaic.first().boundingBox();
    expect(box).not.toBeNull();
  }).toPass();
  box = box!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await expect(side.getByTestId('filters-count')).not.toHaveText(/^50,000 of/);
  await page.mouse.up();
  await expect(page).toHaveURL(/var-mag_lo=\d/);
});

test('the Mosaic panel follows a pick in the filters panel', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const side = dashboardPage.getPanelByTitle('Filters').locator.getByTestId('filters-panel');
  const ticks = dashboardPage
    .getPanelByTitle('Magnitude (Mosaic)')
    .locator.getByTestId('mosaic-panel')
    .locator('[aria-label="y-axis tick label"]');
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(ticks).toContainText('15,000');

  const kind = side.locator(PLOTS).filter({ hasText: 'quarry blast' });
  await expect(async () => {
    await clickValue(kind, 'explosion');
    await expect(side.getByTestId('filters-count')).not.toHaveText(/^50,000 of/, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  // Its histogram now counts only the picked kind: its axis no longer reaches 15,000.
  await expect(ticks).not.toContainText('15,000');
});

test('a new time range moves the counts and breaks nothing', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const side = dashboardPage.getPanelByTitle('Filters').locator.getByTestId('filters-panel');
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(side.locator(PLOTS)).toHaveCount(5, { timeout: 30_000 });
  // A brush first: its pre-aggregates are what a rebuilt time histogram used to break.
  await drag(page, side.locator(PLOTS).nth(1), 0.2, 0.5);
  await expect(page).toHaveURL(/var-mag_lo=\d/);

  // The fixture's quakes are all in September 2026: the last 6 hours hold none.
  await dashboardPage.timeRange.set({ from: 'now-6h', to: 'now' });
  await expect(side.getByTestId('filters-count')).toHaveText(/^0 of 0 quakes/);
  await dashboardPage.timeRange.set({ from: 'now-90d', to: 'now' });
  await expect(side.getByTestId('filters-count')).not.toHaveText(/^0 of/);
  await expect(page.getByTestId('filters-error')).toHaveCount(0);
  await expect(page.getByTestId('mosaic-error')).toHaveCount(0);
});

test('brushes on one column are linked: each shows the other’s range, and the last one moved counts', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const side = dashboardPage.getPanelByTitle('Filters').locator.getByTestId('filters-panel');
  const mosaic = dashboardPage.getPanelByTitle('Magnitude (Mosaic)').locator.getByTestId('mosaic-panel').locator(PLOTS);
  const sql = dashboardPage.getPanelByTitle('Read by Chaski SQL').locator;
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(side.locator(PLOTS)).toHaveCount(5, { timeout: 30_000 });
  const brushOf = (plot: ReturnType<Page['locator']>) => plot.locator('rect.selection');
  const widthOf = async (plot: ReturnType<Page['locator']>) => Number(await brushOf(plot).getAttribute('width'));

  // A brush in the Mosaic panel shows on the filters panel's Magnitude.
  await drag(page, mosaic.first(), 0.3, 0.55);
  await expect(page).toHaveURL(/var-mag_lo=\d/);
  await expect.poll(() => widthOf(side.locator(PLOTS).nth(1))).toBeGreaterThan(10);

  // A brush there takes the column: the Mosaic panel shows it, and the count is the SQL's, not both brushes'.
  await drag(page, side.locator(PLOTS).nth(1), 0.1, 0.35);
  await expect(page).toHaveURL(/var-mag_hi=[0-3]\./);
  const counted = async () =>
    Number((await side.getByTestId('filters-count').textContent())!.split(' of')[0].replace(/,/g, ''));
  const queried = async () =>
    Number((await sql.getByRole('gridcell').or(sql.getByRole('cell')).first().textContent())!.replace(/,/g, ''));
  await expect
    .poll(async () => Math.abs((await counted()) - (await queried())) / (await queried()), { timeout: 20_000 })
    .toBeLessThan(0.02);
  await expect.poll(() => widthOf(mosaic.first())).toBeGreaterThan(10);
});
