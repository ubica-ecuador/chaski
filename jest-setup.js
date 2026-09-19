// Jest setup provided by Grafana scaffolding, loaded only where there is a DOM:
// engine tests run under `@jest-environment node` with DuckDB's Node build, and
// the scaffold's setup touches browser globals (HTMLCanvasElement, matchMedia).
if (typeof window !== 'undefined') {
  require('./.config/jest-setup');

  // jsdom has no Worker. @duckdb/duckdb-wasm's browser build reads the global
  // `Worker` at import time (to wrap it with Comlink), even when nothing ever
  // constructs one — as in datasource.test.ts, which injects a Node-build
  // engine via setEngineForTests and never calls createBrowserRunner. Without
  // this stub, merely importing datasource.ts throws ReferenceError: Worker
  // is not defined.
  if (typeof window.Worker === 'undefined') {
    window.Worker = class Worker {
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    };
  }
}
