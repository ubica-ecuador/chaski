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

// DuckDB quotes the file it could not read; this picks a data proxy URL out of the message.
const PROXY_URL = /https?:\/\/[^\s"']*\/api\/datasources\/proxy\/uid\/[^\s"']+/;

/** The data proxy URL an error names, or undefined. */
export function proxyUrlIn(message: string): string | undefined {
  return PROXY_URL.exec(message)?.[0];
}

/**
 * What to do about a failed read through this datasource's proxy, given the
 * status the proxy answers for that URL (undefined when it could not be asked).
 * Grafana answers an upstream 401 with 400 ("Authentication to data source
 * failed"), so that the viewer isn't logged out, and 400 counts as refused
 * credentials here.
 */
export function explainProxyStatus(status: number | undefined, detail: string): string {
  if (status === 400 || status === 401 || status === 403) {
    return (
      `The server behind this datasource's proxy refused the request (HTTP ${status}). ` +
      `Check the credentials in the datasource settings, and that you may query this datasource. (${detail})`
    );
  }
  if (status === 404) {
    return (
      `Not found on the server behind this datasource's proxy (HTTP 404). ` +
      `Check the path given to $__proxy and the URL in the datasource settings. (${detail})`
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return (
      `Grafana could not reach the server behind this datasource's proxy (HTTP ${status}). ` +
      `Check the URL in the datasource settings. (${detail})`
    );
  }
  return `Reading through this datasource's proxy failed. Check the URL and credentials in the datasource settings. (${detail})`;
}

/** The status the proxy answers for `url` now, or undefined when it can't be asked. */
export async function proxyStatus(url: string): Promise<number | undefined> {
  try {
    return (await fetch(url, { method: 'HEAD', credentials: 'same-origin' })).status;
  } catch {
    return undefined;
  }
}

/**
 * The explanation for a failed read through a data proxy, or undefined when
 * the error is not one. DuckDB-WASM reports every failed HTTP read as "No
 * files found that match the pattern", whatever the status, so the status
 * comes from asking the proxy once more: one HEAD, only after a failure.
 */
export async function explainProxyError(
  error: unknown,
  status: (url: string) => Promise<number | undefined> = proxyStatus
): Promise<string | undefined> {
  const raw = error instanceof Error ? error.message : String(error);
  const url = proxyUrlIn(raw);
  if (!url) {
    return undefined;
  }
  return explainProxyStatus(await status(url), raw.split('\n')[0]);
}
