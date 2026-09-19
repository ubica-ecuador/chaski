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
});
