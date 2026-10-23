import { expect, test } from '@grafana/plugin-e2e';

// The whole demo dashboard on screen: Grafana queries a panel only once it is
// visible, and 12.0 does not even render one below the fold.
test.use({ viewport: { width: 1600, height: 1300 } });

test('a brush filters the other Mosaic panels, and Chaski SQL through the variables it writes', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'mosaic.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const plot = dashboardPage.getPanelByTitle('Magnitude').locator.getByTestId('mosaic-panel').locator('svg').first();
  const count = dashboardPage.getPanelByTitle('Read by Chaski SQL').locator;
  await expect(plot).toBeVisible({ timeout: 60_000 });
  await expect(count).toContainText('50000', { timeout: 60_000 });

  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page).toHaveURL(/var-mag_lo=\d/);
  await expect(page).toHaveURL(/var-mag_hi=\d/);
  await expect(count).not.toContainText('50000');
  await expect(dashboardPage.getPanelByTitle('Filters').locator).toContainText('Magnitude');
});

test('says what it waits for, and what is wrong', async ({ gotoDashboardPage, readProvisionedDashboard }) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'mosaic-states.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = (title: string) => dashboardPage.getPanelByTitle(title).locator;

  await expect(panel('Tiny').getByTestId('mosaic-panel').locator('svg')).toBeVisible({ timeout: 60_000 });
  await expect(panel('Empty')).toContainText('Write a Mosaic spec');
  await expect(panel('Empty')).toContainText('`tiny`');
  await expect(panel('Waiting')).toContainText('Waiting for `nope`');
  await expect(panel('Broken').getByTestId('mosaic-error')).toContainText('does not parse');
  await expect(panel('Bad column').getByTestId('mosaic-error')).toContainText('missing');
});
