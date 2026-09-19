import * as duckdb from '@duckdb/duckdb-wasm';
import type { Table } from 'apache-arrow';

import { quoteLiteral } from './sql';
import { stats } from './stats';
import type { SqlRunner } from './types';

export interface BrowserRunnerOptions {
  /** Absolute URL of the plugin's public folder, ending in '/'. */
  assetBase: string;
  memoryLimitMB: number;
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

  return {
    version,
    async query(sql: string, signal?: AbortSignal): Promise<Table> {
      const conn = await db.connect();
      const cancel = () => {
        void conn.cancelSent();
      };
      signal?.addEventListener('abort', cancel);
      try {
        return await conn.query(sql);
      } finally {
        signal?.removeEventListener('abort', cancel);
        await conn.close();
      }
    },
    async exec(sql: string): Promise<void> {
      const conn = await db.connect();
      try {
        await conn.query(sql);
      } finally {
        await conn.close();
      }
    },
    async insertArrow(name: string, table: Table): Promise<void> {
      const conn = await db.connect();
      try {
        await conn.insertArrowTable(table, { name, create: true });
      } finally {
        await conn.close();
      }
    },
  };
}
