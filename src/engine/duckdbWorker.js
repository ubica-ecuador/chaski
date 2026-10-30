/*
 * DuckDB's worker, started behind a guard on what SQL in a dashboard can reach.
 *
 * Extension code comes only from the plugin's own extensions/ folder, whatever
 * the SQL says (INSTALL x FROM '<url>', LOAD '<url>'). lock_configuration keeps
 * custom_extension_repository where browserRunner.ts set it, but INSTALL ...
 * FROM names a repository of its own and goes around it.
 *
 * On Grafana's own origin, the browser sends the viewer's session with every
 * request, so a read there would see Grafana's API as the viewer. The engine
 * may only reach the plugin's files and the data proxy routes of Chaski
 * datasources ($__proxy) there.
 *
 * DuckDB-WASM reads extensions and remote files by synchronous XMLHttpRequest
 * in this worker, so the guard sits there. A request it refuses is never sent,
 * and an answer is dropped when a redirect took it somewhere refused, or when
 * it is WebAssembly from outside the plugin's folder (LOAD on any URL): all
 * read as a 403 with no body. Other requests pass untouched.
 *
 * The page passes { assets, proxies } in this script's URL hash, or in
 * self.chaskiConfig when it starts it from a blob: (plugin files on a CDN).
 * A blob: worker's origin is the page's, so self.location.origin is Grafana's
 * either way.
 */
(() => {
  'use strict';
  const readHash = () => {
    try {
      return JSON.parse(decodeURIComponent(self.location.hash.slice(1)));
    } catch {
      return {};
    }
  };
  const config = self.chaskiConfig || readHash();
  const base = config.assets || new URL('./', self.location.href).href;
  const proxies = config.proxies || [];
  const grafana = self.location.origin;
  const repository = new URL('extensions/', base).href;
  const EXTENSION_FILE = /\.duckdb_extension(\.wasm)?$/;
  const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

  const resolve = (url) => {
    try {
      return new URL(String(url), base);
    } catch {
      return undefined;
    }
  };
  /** Why a request to `url` may not go, or undefined when it may. */
  const refusal = (url) => {
    if (!url) {
      return undefined;
    }
    if (EXTENSION_FILE.test(url.pathname) && !url.href.startsWith(repository)) {
      return 'extension code from outside the plugin';
    }
    if (url.origin === grafana && !url.href.startsWith(base) && !proxies.some((p) => url.href.startsWith(p))) {
      return "Grafana's origin outside the plugin's files and its data proxy";
    }
    return undefined;
  };
  const isWasm = (xhr) => {
    const bytes = xhr.responseType === 'arraybuffer' && xhr.response ? new Uint8Array(xhr.response) : undefined;
    return Boolean(bytes) && bytes.length >= WASM_MAGIC.length && WASM_MAGIC.every((b, i) => bytes[i] === b);
  };
  const warn = (why, url) => console.warn(`Chaski: refused ${why}: ${url}`);
  const refuse = (xhr, why, url) => {
    warn(why, url);
    Object.defineProperty(xhr, 'status', { value: 403 });
    Object.defineProperty(xhr, 'response', { value: new ArrayBuffer(0) });
  };

  const targets = new WeakMap();
  const proto = XMLHttpRequest.prototype;
  const { open, send } = proto;
  proto.open = function (method, url, ...rest) {
    targets.set(this, resolve(url));
    return open.call(this, method, url, ...rest);
  };
  proto.send = function (...args) {
    const url = targets.get(this);
    const before = refusal(url);
    if (before) {
      refuse(this, before, url.href);
      return;
    }
    send.apply(this, args);
    const landed = this.responseURL ? resolve(this.responseURL) : url;
    const after = refusal(landed);
    if (after) {
      refuse(this, after, landed.href);
    } else if (landed && !landed.href.startsWith(base) && isWasm(this)) {
      refuse(this, 'extension code from outside the plugin', landed.href);
    }
  };

  const fetchFn = self.fetch;
  self.fetch = async (input, ...rest) => {
    const url = resolve(typeof input === 'string' || input instanceof URL ? input : input.url);
    const before = refusal(url);
    if (before) {
      warn(before, url.href);
      return new Response(null, { status: 403 });
    }
    const response = await fetchFn.call(self, input, ...rest);
    const after = response.url ? refusal(resolve(response.url)) : undefined;
    if (after) {
      warn(after, response.url);
      return new Response(null, { status: 403 });
    }
    return response;
  };

  importScripts(new URL('duckdb-browser-eh.worker.js', base).href);
})();
