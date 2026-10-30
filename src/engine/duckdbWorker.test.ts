/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import path from 'path';
import vm from 'vm';

const SOURCE = readFileSync(path.join(__dirname, 'duckdbWorker.js'), 'utf8');
const PLUGIN = 'https://grafana.example/public/plugins/ubica-chaski-datasource/';
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).buffer;
const PARQUET = new TextEncoder().encode('PAR1....').buffer;

/** The guard run as the worker would run it, over a fake XMLHttpRequest answering `bodies`. */
function startWorker(
  bodies: Record<string, ArrayBuffer>,
  { location = `${PLUGIN}duckdb-worker.js`, assets = '' } = {}
) {
  const sent: string[] = [];
  const imported: string[] = [];
  class FakeXHR {
    status = 0;
    response: ArrayBuffer | null = null;
    responseType = '';
    url = '';
    open(_method: string, url: string) {
      this.url = url;
    }
    send() {
      sent.push(this.url);
      this.status = bodies[this.url] ? 200 : 404;
      this.response = bodies[this.url] ?? null;
    }
  }
  const fetched: string[] = [];
  const sandbox: Record<string, unknown> = {
    URL,
    Response,
    Promise,
    WeakMap,
    Uint8Array,
    ArrayBuffer,
    XMLHttpRequest: FakeXHR,
    console: { warn: () => undefined },
    location: { href: location },
    importScripts: (url: string) => imported.push(url),
    fetch: (url: string) => {
      fetched.push(url);
      return Promise.resolve(new Response('ok'));
    },
  };
  sandbox.self = sandbox;
  if (assets) {
    sandbox.chaskiAssets = assets;
  }
  vm.runInNewContext(SOURCE, sandbox);
  const get = (url: string) => {
    const xhr = new FakeXHR();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.send();
    return xhr;
  };
  return { sent, imported, fetched, get, fetch: sandbox.fetch as (url: string) => Promise<Response> };
}

describe('the DuckDB worker guard', () => {
  it("starts DuckDB's worker from the plugin's folder", () => {
    expect(startWorker({}).imported).toEqual([`${PLUGIN}duckdb-browser-eh.worker.js`]);
  });

  it("takes the plugin's folder from the page when started from a blob", () => {
    const worker = startWorker({}, { location: 'blob:https://grafana.example/0b1c', assets: PLUGIN });
    expect(worker.imported).toEqual([`${PLUGIN}duckdb-browser-eh.worker.js`]);
  });

  it("loads an extension from the plugin's own repository", () => {
    const url = `${PLUGIN}extensions/v1.4.3/wasm_eh/spatial.duckdb_extension.wasm`;
    const xhr = startWorker({ [url]: WASM }).get(url);
    expect(xhr.status).toBe(200);
    expect(xhr.response).toBe(WASM);
  });

  it('never sends a request for an extension file anywhere else (INSTALL ... FROM)', () => {
    const url = 'https://elsewhere.example/v1.4.3/wasm_eh/json.duckdb_extension.wasm';
    const worker = startWorker({ [url]: WASM });
    const xhr = worker.get(url);
    expect(worker.sent).toEqual([]);
    expect(xhr.status).toBe(403);
    expect((xhr.response as ArrayBuffer).byteLength).toBe(0);
  });

  it('refuses WebAssembly from outside the plugin, whatever the file is called (LOAD on a URL)', () => {
    const url = 'https://elsewhere.example/payload.bin';
    const xhr = startWorker({ [url]: WASM }).get(url);
    expect(xhr.status).toBe(403);
    expect((xhr.response as ArrayBuffer).byteLength).toBe(0);
  });

  it('passes data from anywhere, and the engine’s own wasm', () => {
    const data = 'https://elsewhere.example/fires.parquet';
    const engine = `${PLUGIN}duckdb-eh.wasm`;
    const worker = startWorker({ [data]: PARQUET, [engine]: WASM });
    expect(worker.get(data).response).toBe(PARQUET);
    expect(worker.get(engine).response).toBe(WASM);
  });

  it('answers a fetch for an extension file elsewhere with a 403, and passes any other', async () => {
    const worker = startWorker({});
    expect((await worker.fetch('https://elsewhere.example/v1.4.3/wasm_eh/h3.duckdb_extension.wasm')).status).toBe(403);
    expect((await worker.fetch(`${PLUGIN}duckdb-eh.wasm`)).status).toBe(200);
    expect(worker.fetched).toEqual([`${PLUGIN}duckdb-eh.wasm`]);
  });
});
