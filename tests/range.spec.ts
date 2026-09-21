import type { Page } from '@playwright/test';
import { expect, test } from '@grafana/plugin-e2e';

import { setTimeRange } from './helpers';

// 0 until the engine is up, seconds after the page loads: expect.poll gives up
// on the first throw, so reading a missing __duckdbwasm would fail the test.
const loadsOf = (page: Page, name: string) =>
  page.evaluate((n) => (window as any).__duckdbwasm?.stats.loads.filter((l: any) => l.name === n).length ?? 0, name);
const reusesOf = (page: Page, name: string) =>
  page.evaluate((n) => (window as any).__duckdbwasm?.stats.reuses.filter((r: any) => r.name === n).length ?? 0, name);

test.describe('a dataset that reloads on time-range change', () => {
  test('keeps its table when the range narrows, without touching the network', async ({ gotoDashboardPage, page }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e-range' });
    const hours = dashboard.getPanelByTitle('Hours in range');
    await expect(hours.locator).toContainText(/\d/, { timeout: 60_000 });
    await expect.poll(() => loadsOf(page, 'viaSource'), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    const before = await hours.locator.innerText();
    const loadsBefore = { hourly: await loadsOf(page, 'hourly'), viaSource: await loadsOf(page, 'viaSource') };

    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes(':8095/')) {
        requests.push(request.url());
      }
    });
    await setTimeRange(page, String(Date.UTC(2026, 0, 2)), String(Date.UTC(2026, 0, 3)));

    await expect.poll(() => reusesOf(page, 'hourly')).toBe(1);
    await expect.poll(() => reusesOf(page, 'viaSource')).toBe(1);
    await expect.poll(() => hours.locator.innerText()).not.toBe(before);
    expect(await loadsOf(page, 'hourly')).toBe(loadsBefore.hourly);
    expect(await loadsOf(page, 'viaSource')).toBe(loadsBefore.viaSource);
    expect(requests).toEqual([]);
  });

  test('keeps its table across presets that both end at now', async ({ gotoDashboardPage, page }) => {
    await gotoDashboardPage({
      uid: 'duckdbwasm-e2e-range',
      queryParams: new URLSearchParams({ from: 'now-7d', to: 'now' }),
    });
    await expect.poll(() => loadsOf(page, 'hourly'), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    const loadsBefore = await loadsOf(page, 'hourly');
    await setTimeRange(page, 'now-24h', 'now');
    await expect.poll(() => reusesOf(page, 'hourly')).toBe(1);
    expect(await loadsOf(page, 'hourly')).toBe(loadsBefore);
  });

  test('reloads on refresh', async ({ gotoDashboardPage, page }) => {
    const dashboard = await gotoDashboardPage({ uid: 'duckdbwasm-e2e-range' });
    await expect.poll(() => loadsOf(page, 'hourly'), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await expect(dashboard.getPanelByTitle('Hours in range').locator).toContainText(/\d/, { timeout: 60_000 });
    const loadsBefore = await loadsOf(page, 'hourly');
    await dashboard.refreshDashboard();
    await expect.poll(() => loadsOf(page, 'hourly')).toBe(loadsBefore + 1);
    expect(await reusesOf(page, 'hourly')).toBe(0);
  });
});
