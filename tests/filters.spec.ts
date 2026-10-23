import { expect, test, type Page } from '@grafana/plugin-e2e';

test.use({ viewport: { width: 1600, height: 1300 } });

/** Drags across a plot from one fraction of its width to another. */
async function drag(page: Page, plot: ReturnType<Page['locator']>, from: number, to: number) {
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.4, { steps: 8 });
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
  const plots = side.locator('svg');

  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(plots).toHaveCount(5);
  await expect(count).toContainText('50000', { timeout: 60_000 });

  // A value: click its bar. The variable is written, every count follows, and the other values stay
  // listed with their counts: a control is counted under every filter but its own.
  const kind = plots.filter({ hasText: 'quarry blast' });
  await expect(kind).toContainText(/42,?927/);
  // A click while Mosaic is still drawing the bars can land on the plot it replaces: try again until it holds.
  await expect(async () => {
    // The bars in the values' order: earthquake, explosion, …
    await kind.locator('[aria-label="bar"] rect').nth(1).click({ force: true });
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

  await drag(page, mosaic.first(), 0.35, 0.6);
  await expect(side.getByTestId('filters-count')).not.toHaveText(/^50,000 of/);
  await expect(page).toHaveURL(/var-mag_lo=\d/);
  // The filters panel shows the range without a second clause of its own: its histogram keeps every bin.
  await expect(side).toContainText('Magnitude');
});
