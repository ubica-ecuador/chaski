/**
 * Grafana's data proxy, as `$__proxy` uses it. Every read goes through one of
 * the routes in plugin.json: `_key` when the instance adds an API key to the
 * query string, `_plain` otherwise. Grafana matches routes by string prefix,
 * so always naming one keeps an upstream path that starts with "_key" out of
 * the key route.
 */
export const PLAIN_ROUTE = '_plain';
export const KEY_ROUTE = '_key';
export type ProxyRoute = typeof PLAIN_ROUTE | typeof KEY_ROUTE;

/**
 * The absolute URL `$__proxy` prefixes, with no trailing slash. DuckDB treats
 * anything without http(s):// as a local file, so the instance's
 * `/api/datasources/proxy/uid/<uid>` is resolved on the page's origin. When
 * Grafana is served from a sub-path, that sub-path is added unless the
 * instance URL already carries it. `baseURI` is the page's, which Grafana's
 * <base href> sets to its sub-path, as `assetBase()` relies on too.
 */
export function proxyBaseUrl(instanceUrl: string, route: ProxyRoute, baseURI: string = document.baseURI): string {
  const base = new URL(baseURI);
  const subPath = base.pathname.replace(/\/+$/, '');
  const path = subPath && !instanceUrl.startsWith(`${subPath}/`) ? `${subPath}${instanceUrl}` : instanceUrl;
  return new URL(`${path.replace(/\/+$/, '')}/${route}`, base.origin).href;
}
