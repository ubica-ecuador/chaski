/** @jest-environment node */
import { DatasetViews, viewOf } from './datasetViews';
import { createNodeRunner } from './testing/nodeRunner';
import type { DatasetState, SqlRunner } from './types';

const stateOf = (name: string, table: string): DatasetState => ({
  dashboard: 'd',
  name,
  table,
  version: 1,
  loadedAt: 0,
  rows: 0,
});
const views = async (runner: SqlRunner) =>
  (await runner.query("SELECT view_name FROM duckdb_views() WHERE schema_name = 'datasets' ORDER BY 1"))
    .toArray()
    .map((row) => String(row.view_name));
const countThrough = async (runner: SqlRunner, name: string) =>
  Number((await runner.query(`SELECT count(*)::DOUBLE AS n FROM ${viewOf(name)}`)).get(0)?.n);

let runner: SqlRunner;
beforeEach(async () => {
  runner = await createNodeRunner();
  await runner.exec('CREATE TABLE t1 AS SELECT range AS n FROM range(1)');
  await runner.exec('CREATE TABLE t2 AS SELECT range AS n FROM range(2)');
  await runner.exec('CREATE TABLE t3 AS SELECT range AS n FROM range(3)');
});

describe('DatasetViews', () => {
  it('reads each dataset through a view named after it', async () => {
    await new DatasetViews(runner).sync([stateOf('a', 't1'), stateOf('b', 't2')]);
    expect(await views(runner)).toEqual(['a', 'b']);
    expect(await countThrough(runner, 'a')).toBe(1);
    expect(await countThrough(runner, 'b')).toBe(2);
  });

  it('re-points a view at a new version and drops views of datasets that are gone', async () => {
    const sut = new DatasetViews(runner);
    await sut.sync([stateOf('a', 't1'), stateOf('b', 't2')]);
    await sut.sync([stateOf('a', 't3')]);
    expect(await views(runner)).toEqual(['a']);
    expect(await countThrough(runner, 'a')).toBe(3);
  });

  it('quotes names that need it', async () => {
    const odd = 'My "odd" Name';
    await new DatasetViews(runner).sync([stateOf(odd, 't2')]);
    expect(viewOf(odd)).toBe('datasets."My ""odd"" Name"');
    expect(await countThrough(runner, odd)).toBe(2);
  });

  it('applies syncs in call order', async () => {
    const sut = new DatasetViews(runner);
    const first = sut.sync([stateOf('a', 't1')]);
    const second = sut.sync([stateOf('a', 't3')]);
    await Promise.all([first, second]);
    expect(await countThrough(runner, 'a')).toBe(3);
  });

  it('reports a view it cannot create, still creates the others, and never throws', async () => {
    const errors: unknown[] = [];
    await new DatasetViews(runner, (error) => errors.push(error)).sync([
      stateOf('broken', 'no_such_table'),
      stateOf('ok', 't1'),
    ]);
    expect(errors).toHaveLength(1);
    expect(await views(runner)).toEqual(['ok']);
  });
});
