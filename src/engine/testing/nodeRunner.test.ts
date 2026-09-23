/** @jest-environment node */
import { DUCKDB_VERSION } from '../duckdbVersion';
import { createNodeRunner } from './nodeRunner';

describe('createNodeRunner', () => {
  it('runs the same DuckDB version the plugin ships extensions for', async () => {
    const runner = await createNodeRunner();
    const result = await runner.query('SELECT version() AS v');
    expect(String(result.get(0)?.v)).toBe(DUCKDB_VERSION);
  });

  it('creates and reads tables', async () => {
    const runner = await createNodeRunner();
    await runner.exec('CREATE TABLE t AS SELECT range AS n FROM range(3)');
    const result = await runner.query('SELECT sum(n)::DOUBLE AS s FROM t');
    expect(result.get(0)?.s).toBe(3);
  });

  it("keeps each session's USE and search_path to itself", async () => {
    const runner = await createNodeRunner();
    await runner.exec(
      'CREATE SCHEMA explore; CREATE SCHEMA datasets; CREATE TABLE main.t AS SELECT 1 AS n; ' +
        'CREATE VIEW datasets.sample AS SELECT 42 AS n'
    );
    const session = await runner.openSession!(['USE explore', "SET search_path = 'explore,datasets'"]);
    await session.query('CREATE TABLE hot AS SELECT 7 AS n');
    expect((await session.query('SELECT n FROM sample')).get(0)?.n).toBe(42);
    expect((await session.query('SELECT n FROM datasets.sample')).get(0)?.n).toBe(42);
    const where = await runner.query("SELECT schema_name FROM duckdb_tables() WHERE table_name = 'hot'");
    expect(where.get(0)?.schema_name).toBe('explore');
    // The panels' connection is untouched: its unqualified names still resolve in main.
    expect((await runner.query('SELECT n FROM t')).get(0)?.n).toBe(1);
    await session.close();
  });
});
