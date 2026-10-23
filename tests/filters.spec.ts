import { expect, test } from '@grafana/plugin-e2e';

test.use({ viewport: { width: 1600, height: 1300 } });

test('the filters panel counts each control under the other filters, and sets and clears them', async ({
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

  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(count).toContainText('50000', { timeout: 60_000 });

  // A value: the variable is written, every count follows, the picked value stays listed.
  await side.getByRole('button', { name: /^explosion/ }).click();
  await expect(page).toHaveURL(/var-kinds=explosion/);
  await expect(side.getByTestId('filters-count')).not.toHaveText(/^50,000/);
  await expect(count).not.toContainText('50000');
  await expect(side.getByRole('button', { name: /^explosion/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(strip).toContainText('Kind: explosion');

  // A brush on a histogram writes both ends, rounded to the axis.
  const histogram = side.locator('svg[role="slider"]').nth(1);
  const box = (await histogram.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/var-mag_lo=\d(\.\d{1,2})?&/);
  await expect(page).toHaveURL(/var-mag_hi=\d(\.\d{1,2})?&/);

  // A search box writes once typing pauses.
  await side.getByLabel('Search Place').fill('Zone 1');
  await expect(page).toHaveURL(/var-q=Zone(%20|\+)1/);

  // Clear all empties every filter's variables.
  await strip.getByRole('button', { name: 'Clear all' }).click();
  await expect(side.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes');
  await expect(count).toContainText('50000');
  await expect(page.getByTestId('filters-error')).toHaveCount(0);
});
