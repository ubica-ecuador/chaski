import { expect, test } from '@grafana/plugin-e2e';

test.use({ viewport: { width: 1600, height: 1100 } });

/** The window's start the URL holds now, in epoch milliseconds. */
const startOf = (url: string) => Date.parse(new URL(url).searchParams.get('var-t0') ?? '');

test('the timeline plays its brush a bin at a time, and the variables and counts follow each step', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await readProvisionedDashboard({ fileName: 'filters-timeline.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const timeline = dashboardPage.getPanelByTitle('Timeline').locator.getByTestId('filters-panel');
  const window = timeline.getByTestId('filters-window');
  const read = dashboardPage.getPanelByTitle('Window read from the variables').locator;
  await expect(timeline.getByTestId('filters-count')).toHaveText('50,000 of 50,000 quakes', { timeout: 60_000 });
  await expect(timeline.getByRole('button', { name: 'Step back' })).toBeDisabled();

  // Play starts a tenth of the axis wide at its start, and moves on.
  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect(timeline.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page).toHaveURL(/var-t0=2026-09-0\dT/);
  await expect(window).toHaveText(/^2026-09-0\d/);
  await expect(timeline.getByTestId('filters-count')).not.toHaveText(/^50,000 of/);
  const first = startOf(page.url());
  await expect.poll(() => startOf(page.url()), { timeout: 10_000 }).toBeGreaterThan(first);
  await expect(read).toContainText('From 2026-09-0');

  // Paused, it stays.
  await timeline.getByRole('button', { name: 'Pause' }).click();
  await expect(timeline.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForTimeout(600);
  const held = startOf(page.url());
  await page.waitForTimeout(1500);
  expect(startOf(page.url())).toBe(held);

  // A step either way moves it by one bin, and back.
  await timeline.getByRole('button', { name: 'Step forward' }).click();
  await expect.poll(() => startOf(page.url())).toBeGreaterThan(held);
  const bin = startOf(page.url()) - held;
  expect(bin).toBeGreaterThan(0);
  await timeline.getByRole('button', { name: 'Step back' }).click();
  await expect.poll(() => startOf(page.url())).toBe(held);

  // A drag on the histogram pauses play and sets the window by hand.
  await timeline.getByRole('button', { name: 'Play' }).click();
  await expect(timeline.getByRole('button', { name: 'Pause' })).toBeVisible();
  const box = (await timeline.locator('svg').last().boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(timeline.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page).toHaveURL(/var-t0=2026-09-(1[5-9]|2\d)/);
  await expect(page.getByTestId('filters-error')).toHaveCount(0);
});
