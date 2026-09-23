import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';

import { tableFromBatches } from './arrowTable';
import { missingExtension } from './extensions';
import { quoteLiteral } from './sql';
import { stats } from './stats';
import type { SqlRunner, SqlSession } from './types';

export interface BrowserRunnerOptions {
  /** Absolute URL of the plugin's public folder, ending in '/'. */
  assetBase: string;
  memoryLimitMB: number;
}

/**
 * Runs one statement on an already-open connection and returns its rows as
 * Arrow. Shared by the runner's own per-call connection and by sessions'
 * long-lived one.
 */
async function runOnConnection(conn: duckdb.AsyncDuckDBConnection, sql: string, signal?: AbortSignal): Promise<Table> {
  if (signal?.aborted) {
    throw new DOMException('The query was cancelled', 'AbortError');
  }
  const cancel = () => {
    void conn.cancelSent();
  };
  signal?.addEventListener('abort', cancel);
  try {
    // Cancellation only works through the pending-query API: conn.query()
    // ignores cancelSent(), so a query run that way could never be stopped.
    const reader = await conn.send(sql);
    const batches = await reader.readAll();
    return tableFromBatches(reader.schema, batches);
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

/**
 * DuckDB-WASM in a Worker, so Grafana's UI never waits on a query. It uses the
 * single-threaded `eh` build: Grafana sends no COOP/COEP headers, so the
 * threaded build could not start.
 *
 * Each statement gets its own connection. Tables are shared (one in-memory
 * database), and cancelling one panel's query cannot touch another's.
 */
export async function createBrowserRunner(options: BrowserRunnerOptions): Promise<SqlRunner & { version: string }> {
  const started = performance.now();
  const worker = new Worker(new URL('duckdb-browser-eh.worker.js', options.assetBase).href);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(new URL('duckdb-eh.wasm', options.assetBase).href, null);
  await db.open({ query: { castBigIntToDouble: true } });

  const setup = await db.connect();
  // Extensions come from the plugin's own dist/extensions/<version>/wasm_eh/:
  // a signed plugin may not load code from extensions.duckdb.org.
  const repository = new URL('extensions', options.assetBase).href;
  await setup.query(`SET custom_extension_repository = ${quoteLiteral(repository)}`);
  await setup.query('SET autoinstall_known_extensions = true');
  await setup.query('SET autoload_known_extensions = true');
  await setup.query(`SET memory_limit = '${Math.max(64, Math.round(options.memoryLimitMB))}MB'`);
  const version = String((await setup.query('SELECT version() AS v')).get(0)?.v ?? 'unknown');
  await setup.close();
  stats.engineStartMs = performance.now() - started;

  // autoload_known_extensions only covers table functions such as
  // read_parquet/read_json (duckdb-wasm resolves those through a replacement
  // scan that can await a fetch). A bare scalar call like ST_Point or
  // ST_AsWKB never reaches that path: DuckDB-WASM does not implement
  // binder-time autoload for scalar functions, so it throws a Catalog Error
  // telling the caller to run INSTALL/LOAD by hand instead of fetching the
  // extension. Loading every shipped extension up front would make every
  // engine start pay for the 22 MB spatial extension even when a dashboard
  // never touches geometry, so instead each extension is loaded the first
  // time a statement actually needs it, and that one statement is retried.
  const loading = new Map<string, Promise<void>>();
  function ensureLoaded(name: string): Promise<void> {
    let promise = loading.get(name);
    if (!promise) {
      promise = (async () => {
        const conn = await db.connect();
        try {
          await conn.query(`LOAD ${name}`);
        } finally {
          await conn.close();
        }
      })();
      // A failed load must not be remembered as loaded: clear it so the next
      // statement that needs this extension tries again. Attached separately
      // from `promise` itself, so callers awaiting the shared promise still
      // see the rejection.
      promise.catch(() => loading.delete(name));
      loading.set(name, promise);
    }
    return promise;
  }

  /** Runs `action` once; on a missing-shipped-extension error, loads it and retries exactly once. */
  async function withExtensionRetry<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = missingExtension(message);
      if (!name) {
        throw error;
      }
      await ensureLoaded(name);
      return action();
    }
  }

  return {
    version,
    query(sql: string, signal?: AbortSignal): Promise<Table> {
      return withExtensionRetry(async () => {
        const conn = await db.connect();
        try {
          return await runOnConnection(conn, sql, signal);
        } finally {
          await conn.close();
        }
      });
    },
    exec(sql: string): Promise<void> {
      return withExtensionRetry(async () => {
        const conn = await db.connect();
        try {
          await conn.query(sql);
        } finally {
          await conn.close();
        }
      });
    },
    async insertArrow(name: string, table: Table): Promise<void> {
      const conn = await db.connect();
      try {
        await conn.insertArrowTable(table, { name, create: true });
      } finally {
        await conn.close();
      }
    },
    async openSession(setup: string[]): Promise<SqlSession> {
      const conn = await db.connect();
      try {
        for (const sql of setup) {
          await conn.query(sql);
        }
      } catch (error) {
        await conn.close();
        throw error;
      }
      return {
        query(sql: string, signal?: AbortSignal): Promise<Table> {
          return withExtensionRetry(() => runOnConnection(conn, sql, signal));
        },
        close: () => conn.close(),
      };
    },
  };
}
