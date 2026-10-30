/*
 * DuckDB's worker, started behind a guard: whatever SQL a dashboard runs
 * (INSTALL x FROM '<url>', LOAD '<url>'), the engine takes extension code only
 * from the plugin's own extensions/ folder. lock_configuration keeps
 * custom_extension_repository where browserRunner.ts set it, but INSTALL ...
 * FROM names a repository of its own and goes around it.
 *
 * DuckDB-WASM fetches extensions, like remote files, by synchronous
 * XMLHttpRequest in this worker, so the guard sits there. A request outside
 * that folder for an extension file is never sent, and one whose answer is
 * WebAssembly from outside the plugin's folder (LOAD on any URL) is dropped:
 * both read as a 403 with no body, and DuckDB reports that the extension is
 * not available. Data requests pass untouched.
 *
 * The plugin's public folder is the folder of this script, or self.chaskiAssets
 * when the page starts it from a blob: (plugin files on a CDN).
 */
(() => {
  'use strict';
  const base = self.chaskiAssets || new URL('./', self.location.href).href;
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
  const foreignExtension = (url) =>
    Boolean(url) && EXTENSION_FILE.test(url.pathname) && !url.href.startsWith(repository);
  const isWasm = (xhr) => {
    const bytes = xhr.responseType === 'arraybuffer' && xhr.response ? new Uint8Array(xhr.response) : undefined;
    return Boolean(bytes) && bytes.length >= WASM_MAGIC.length && WASM_MAGIC.every((b, i) => bytes[i] === b);
  };
  const refuse = (xhr, url) => {
    console.warn(`Chaski: refused extension code from outside the plugin: ${url}`);
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
    if (foreignExtension(url)) {
      refuse(this, url.href);
      return;
    }
    send.apply(this, args);
    if (url && !url.href.startsWith(base) && isWasm(this)) {
      refuse(this, url.href);
    }
  };

  const fetchFn = self.fetch;
  self.fetch = (input, ...rest) => {
    const url = resolve(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (foreignExtension(url)) {
      console.warn(`Chaski: refused extension code from outside the plugin: ${url.href}`);
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    return fetchFn.call(self, input, ...rest);
  };

  importScripts(new URL('duckdb-browser-eh.worker.js', base).href);
})();
