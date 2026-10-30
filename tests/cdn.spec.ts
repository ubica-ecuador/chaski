import { expect, test } from '@playwright/test';

// Runs against grafana-cdn (docker-compose.yaml), which serves the plugin the
// way Grafana Cloud does: its files come from a CDN on another origin.
test.beforeEach(async ({ page }) => {
  const login = await page.request.post('/login', { data: { user: 'admin', password: 'admin' } });
  expect(login.ok()).toBe(true);
});

test('the engine starts when Grafana serves the plugin from a CDN', async ({ page, baseURL }) => {
  // A first start pulls the engine and the spatial extension through the CDN, which can take over 30 s.
  test.setTimeout(120_000);
  const settings = await (await page.request.get('/api/plugins/ubica-chaski-datasource/settings')).json();
  // Without a CDN this test proves nothing: every file would be same-origin.
  expect(new URL(settings.module).origin).not.toBe(new URL(baseURL!).origin);

  await page.goto('/connections/datasources/edit/duckdbwasm');
  await page.getByRole('button', { name: 'Save & test' }).click();
  await expect(page.getByText(/DuckDB v1\.4\.3 is running in the browser\./)).toBeVisible({ timeout: 60_000 });

  // Extensions come from the same CDN, through custom_extension_repository.
  const point = await page.evaluate(async () => {
    const table = await (window as any).__duckdbwasm.runner.query('SELECT ST_AsText(ST_Point(1, 2)) AS p');
    return table.toArray()[0].toJSON().p;
  });
  expect(point).toBe('POINT (1 2)');

  // A worker started from a blob: has the page's origin: Grafana's API stays out of reach there too.
  const api = `${new URL(baseURL!).origin}/api/user`;
  const refused = await page.evaluate(async (api) => {
    try {
      await (window as any).__duckdbwasm.runner.query(`SELECT * FROM read_json('${api}')`);
      return 'read';
    } catch (error) {
      return String((error as Error).message);
    }
  }, api);
  expect(refused).toContain(`No files found that match the pattern "${api}"`);
});
