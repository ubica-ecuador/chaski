/** @jest-environment node */
import { createNodeRunner } from './testing/nodeRunner';
import { describe as describeSql, runPanelQuery } from './executor';
import type { SqlRunner } from './types';

let runner: SqlRunner;

beforeAll(async () => {
  runner = await createNodeRunner();
  await runner.exec(
    "CREATE TABLE cities AS SELECT * FROM (VALUES ('Quito', 1), ('Cuenca', 2), ('Quito', 3)) AS t(city, n)"
  );
});

describe('describe', () => {
  it('lists the columns and types of any SELECT', async () => {
    expect(await describeSql(runner, 'SELECT city, n::HUGEINT AS big FROM cities;')).toEqual([
      { name: 'city', type: 'VARCHAR' },
      { name: 'big', type: 'HUGEINT' },
    ]);
  });
});

describe('runPanelQuery', () => {
  it('runs plain SQL untouched', async () => {
    const result = await runPanelQuery(runner, 'SELECT count(*)::DOUBLE AS c FROM cities;');
    expect(result.executed).toBe('SELECT count(*)::DOUBLE AS c FROM cities');
    expect(result.table.get(0)?.c).toBe(3);
  });

  it('wraps the ad hoc filters that apply', async () => {
    const result = await runPanelQuery(runner, 'SELECT city, n FROM cities', {
      filters: [
        { key: 'city', operator: '=', value: 'Quito' },
        { key: 'elsewhere', operator: '=', value: 'x' },
      ],
    });
    expect(result.executed).toBe(`SELECT * FROM (SELECT city, n FROM cities) AS q WHERE "city" = 'Quito'`);
    expect(result.table.numRows).toBe(2);
  });

  it('casts HUGEINT to DOUBLE so the frame gets a number', async () => {
    const result = await runPanelQuery(runner, 'SELECT sum(n)::HUGEINT AS total FROM cities');
    expect(result.executed).toContain('CAST("total" AS DOUBLE)');
    expect(result.table.get(0)?.total).toBe(6);
  });

  it('runs a statement DESCRIBE cannot wrap as written', async () => {
    const result = await runPanelQuery(runner, 'PRAGMA version');
    expect(result.executed).toBe('PRAGMA version');
    expect(result.columns).toEqual([]);
    expect(result.table.numRows).toBe(1);
  });

  it('surfaces DuckDB errors from the real statement', async () => {
    await expect(runPanelQuery(runner, 'SELECT * FROM nowhere')).rejects.toThrow('Table with name nowhere does not exist');
  });
});
