/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const SOURCE = readFileSync(path.join(__dirname, 'duckdbWorker.js'), 'utf8');
const GRAFANA = 'https://grafana.example';
const PLUGIN = `${GRAFANA}/public/plugins/ubica-chaski-datasource/`;
const PROXY = `${GRAFANA}/api/datasources/proxy/uid/files/_plain/`;
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).buffer;
const PARQUET = new TextEncoder().encode('PAR1....').buffer;

interface Answer {
  body: ArrayBuffer;
  /** Where a redirect left the request. */
  landed?: string;
}

/**
 * The guard run as the worker would run it, over a fake XMLHttpRequest
 * answering `answers`. By default started the same-origin way, its settings in
 * the URL hash; with `blob`, the CDN way.
 */
function startWorker(answers: Record<string, Answer>, { blob = false } = {}) {
  const config = { assets: PLUGIN, proxies: [PROXY] };
  const href = blob
    ? `blob:${GRAFANA}/0b1c`
    : `${PLUGIN}duckdb-worker.js#${encodeURIComponent(JSON.stringify(config))}`;
  const sent: string[] = [];
  const imported: string[] = [];
  class FakeXHR {
    status = 0;
    response: ArrayBuffer | null = null;
    responseType = '';
    responseURL = '';
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      sent.push(this.url);
      const answer = answers[this.url];
      this.status = answer ? 200 : 404;
      this.response = answer?.body ?? null;
      this.responseURL = answer?.landed ?? this.url;
    }
  }
  const sandbox: Record<string, unknown> = {
    URL,
    Response,
    Promise,
    WeakMap,
    Uint8Array,
    ArrayBuffer,
    JSON,
    XMLHttpRequest: FakeXHR,
    console: { warn: () => undefined },
    location: new URL(href),
    importScripts: (url: string) => imported.push(url),
    fetch: (url: string) => Promise.resolve({ status: 200, url }),
  };
  sandbox.self = sandbox;
  sandbox.decodeURIComponent = decodeURIComponent;
  if (blob) {
    sandbox.chaskiConfig = config;
  }
  vm.runInNewContext(SOURCE, sandbox);
  const get = (url: string) => {
    const xhr = new FakeXHR();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.send();
    return xhr;
  };
  return { sent, imported, get, fetch: sandbox.fetch as (url: string) => Promise<Response> };
}

const refused = (xhr: { status: number; response: ArrayBuffer | null }) =>
  xhr.status === 403 && (xhr.response as ArrayBuffer).byteLength === 0;

describe('the DuckDB worker guard', () => {
  it("starts DuckDB's worker from the plugin's folder, started either way", () => {
    expect(startWorker({}).imported).toEqual([`${PLUGIN}duckdb-browser-eh.worker.js`]);
    expect(startWorker({}, { blob: true }).imported).toEqual([`${PLUGIN}duckdb-browser-eh.worker.js`]);
  });

  it("loads an extension from the plugin's own repository", () => {
    const url = `${PLUGIN}extensions/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm`;
    expect(startWorker({ [url]: { body: WASM } }).get(url).response).toBe(WASM);
  });

  it('never sends a request for an extension file anywhere else (INSTALL ... FROM)', () => {
    const url = 'https://elsewhere.example/v1.4.3/wasm_eh/json.duckdb_extension.wasm';
    const worker = startWorker({ [url]: { body: WASM } });
    expect(refused(worker.get(url))).toBe(true);
    expect(worker.sent).toEqual([]);
  });

  it('refuses WebAssembly from outside the plugin, whatever the file is called (LOAD on a URL)', () => {
    const url = 'https://elsewhere.example/payload.bin';
    expect(refused(startWorker({ [url]: { body: WASM } }).get(url))).toBe(true);
  });

  it('passes data from anywhere else, and the engine’s own wasm', () => {
    const data = 'https://elsewhere.example/fires.parquet';
    const engine = `${PLUGIN}duckdb-eh.wasm`;
    const worker = startWorker({ [data]: { body: PARQUET }, [engine]: { body: WASM } });
    expect(worker.get(data).response).toBe(PARQUET);
    expect(worker.get(engine).response).toBe(WASM);
  });

  it.each([false, true])(
    "never sends a request to Grafana's API, pages or another datasource's proxy (blob: %s)",
    (blob) => {
      const urls = [
        `${GRAFANA}/api/user`,
        `${GRAFANA}/apis/dashboard.grafana.app/v1/namespaces/default/dashboards`,
        `${GRAFANA}/d/abc`,
        `${GRAFANA}/api/datasources/proxy/uid/prometheus/api/v1/query?query=up`,
        `${GRAFANA}/api/datasources/proxy/uid/files/raw.parquet`,
        '/api/search',
      ];
      const worker = startWorker(Object.fromEntries(urls.map((u) => [u, { body: PARQUET }])), { blob });
      for (const url of urls) {
        expect(refused(worker.get(url))).toBe(true);
      }
      expect(worker.sent).toEqual([]);
    }
  );

  it("reads through a Chaski datasource's proxy route", () => {
    const url = `${PROXY}cuenca/vias.parquet`;
    expect(startWorker({ [url]: { body: PARQUET } }).get(url).response).toBe(PARQUET);
  });

  it("drops an answer a redirect brought from Grafana's API", () => {
    const url = `${PROXY}moved.parquet`;
    expect(refused(startWorker({ [url]: { body: PARQUET, landed: `${GRAFANA}/api/user` } }).get(url))).toBe(true);
  });

  it('answers a refused fetch with a 403, and passes any other', async () => {
    const worker = startWorker({});
    expect((await worker.fetch('https://elsewhere.example/v1.4.3/wasm_eh/h3.duckdb_extension.wasm')).status).toBe(403);
    expect((await worker.fetch(`${GRAFANA}/api/user`)).status).toBe(403);
    expect((await worker.fetch(`${PLUGIN}duckdb-eh.wasm`)).status).toBe(200);
  });
});
