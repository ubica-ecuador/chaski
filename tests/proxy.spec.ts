import { expect, test } from '@grafana/plugin-e2e';

test.describe('files read through the data proxy', () => {
  test('reads a file behind a token, basic auth or a key in the URL, into panels and a dataset', async ({
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const provisioned = await readProvisionedDashboard({ fileName: 'e2e-proxy.json' });
    const dashboard = await gotoDashboardPage({ uid: provisioned.uid });
    for (const title of ['Bearer token', 'Basic auth', 'Key in the URL', 'Dataset via proxy']) {
      await expect(dashboard.getPanelByTitle(title).data).toContainText(['1000'], { timeout: 60_000 });
    }
  });

  test('explains a rejected credential', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
    const provisioned = await readProvisionedDashboard({ fileName: 'e2e-proxy.json' });
    const dashboard = await gotoDashboardPage({ uid: provisioned.uid });
    const panel = dashboard.getPanelByTitle('Wrong token');
    await expect(panel.getErrorIcon()).toBeVisible({ timeout: 60_000 });
    await panel.getErrorIcon().hover();
    await expect(page.getByRole('tooltip')).toContainText('refused the request');
  });

  test('cannot read the same file without the proxy', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
    const provisioned = await readProvisionedDashboard({ fileName: 'e2e-proxy.json' });
    const dashboard = await gotoDashboardPage({ uid: provisioned.uid });
    const panel = dashboard.getPanelByTitle('Direct, no proxy');
    await expect(panel.getErrorIcon()).toBeVisible({ timeout: 60_000 });
    await panel.getErrorIcon().hover();
    await expect(page.getByRole('tooltip')).toContainText('CORS');
  });
});
