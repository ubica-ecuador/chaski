import path from 'path';
import type { Table } from 'apache-arrow';

import type { SqlRunner } from '../types';

// The Node build of the very same DuckDB-WASM the browser runs, blocking and
// in-process, so engine tests exercise real SQL. Tests only: nothing in the
// plugin bundle imports this file.
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

export async function createNodeRunner(): Promise<SqlRunner> {
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
  const bundles = {
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate(() => undefined);
  // Same option as the browser runner: BIGINT arrives as a JS number, not a BigInt.
  db.open({ query: { castBigIntToDouble: true } });
  const conn = db.connect();
  return {
    async query(sql: string): Promise<Table> {
      return conn.query(sql);
    },
    async exec(sql: string): Promise<void> {
      conn.query(sql);
    },
    async insertArrow(name: string, table: Table): Promise<void> {
      conn.insertArrowTable(table, { name, create: true });
    },
  };
}
