import { expect, test } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

/** The message a statement on the panels' connection fails with; undefined when it runs. */
function failure(page: Page, sql: string): Promise<string | undefined> {
  return page.evaluate(async (sql) => {
    try {
      await (window as any).__duckdbwasm.runner.query(sql);
      return undefined;
    } catch (error) {
      return String((error as Error).message);
    }
  }, sql);
}

// The plugin CDN of docker-compose.yaml serves this same build's signed extensions with open CORS:
// without the worker's guard, spatial would load from there.
const ELSEWHERE =
  'http://localhost:8096/ubica-chaski-app/0/public/plugins/ubica-chaski-app/plugins/datasource/extensions';

test('SQL cannot change the engine settings, nor take extension code from another origin', async ({ page }) => {
  await page.goto('/connections/datasources/edit/duckdbwasm');
  await page.getByRole('button', { name: 'Save & test' }).click();
  await expect(page.getByText(/DuckDB v1\.4\.3 is running in the browser\./)).toBeVisible({ timeout: 60_000 });

  for (const setting of [`SET custom_extension_repository = '${ELSEWHERE}'`, "SET memory_limit = '8GB'"]) {
    expect(await failure(page, setting)).toContain('the configuration has been locked');
  }
  expect(await failure(page, 'SET VARIABLE answer = 42')).toBeUndefined();

  expect(await failure(page, `INSTALL spatial FROM '${ELSEWHERE}'`)).toBeUndefined();
  expect(await failure(page, 'SELECT ST_AsText(ST_Point(1, 2)) AS p')).toMatch(/spatial.*not available/s);
});
