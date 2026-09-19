import { expect, test } from '@grafana/plugin-e2e';

test('Save & test starts DuckDB in the browser', async ({ gotoDataSourceConfigPage, page, selectors }) => {
  const configPage = await gotoDataSourceConfigPage('duckdbwasm');
  // configPage.saveAndTest() waits for a response from the datasource's
  // `/health` HTTP endpoint, which only exists for plugins with a backend.
  // This datasource has none: testDatasource() runs entirely in the browser,
  // so Grafana never issues that request and the helper hangs until it times
  // out. Click the real "Save & test" button instead, and read the real
  // status text the engine reports once it has actually started.
  await configPage.getByGrafanaSelector(selectors.pages.DataSource.saveAndTest).click();
  await expect(page.getByText(/DuckDB v1\.4\.3 is running in the browser\./)).toBeVisible({ timeout: 60_000 });
});
