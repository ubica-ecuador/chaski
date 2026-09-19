import type { Page } from '@playwright/test';

/**
 * Moves a dashboard variable in place, without a reload: Grafana follows the
 * URL through its history listener. A page.goto would reload the page and
 * restart the engine, which is exactly what these tests must not do.
 */
export async function setVariable(page: Page, name: string, values: string[]): Promise<void> {
  await page.evaluate(
    ({ name, values }) => {
      const url = new URL(window.location.href);
      url.searchParams.delete(`var-${name}`);
      for (const v of values) {
        url.searchParams.append(`var-${name}`, v);
      }
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    { name, values }
  );
}

/** How many panel queries the engine has answered so far on this page. */
export function answeredQueries(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__duckdbwasm?.stats?.queries?.length ?? 0);
}
