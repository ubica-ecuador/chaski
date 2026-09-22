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
    await expect(runPanelQuery(runner, 'SELECT * FROM nowhere')).rejects.toThrow(
      'Table with name nowhere does not exist'
    );
  });
});

describe('runPanelQuery reusing columns', () => {
  /** The same DuckDB, counting the statements sent: each wrapper is a runner with its own schema cache. */
  function counting() {
    const sent: string[] = [];
    const spy: SqlRunner = {
      ...runner,
      query: (sql: string, signal?: AbortSignal) => {
        sent.push(sql);
        return runner.query(sql, signal);
      },
    };
    const describes = () => sent.filter((sql) => sql.startsWith('DESCRIBE')).length;
    return { spy, sent, describes };
  }
  const fieldNames = (result: { table: { schema: { fields: Array<{ name: string }> } } }) =>
    result.table.schema.fields.map((f) => f.name);

  beforeAll(async () => {
    await runner.exec('CREATE TABLE cities_v1 AS SELECT * FROM cities');
    await runner.exec('CREATE TABLE cities_v2 AS SELECT * FROM cities');
  });

  it('does not describe again when only a quoted value changed', async () => {
    const { spy, sent, describes } = counting();
    await runPanelQuery(spy, "SELECT city, n FROM cities WHERE city = 'Quito'");
    const second = await runPanelQuery(spy, "SELECT city, n FROM cities WHERE city = 'Cuenca'");
    expect(describes()).toBe(1);
    expect(sent).toHaveLength(3);
    expect(second.executed).toBe("SELECT city, n FROM cities WHERE city = 'Cuenca'");
    expect(second.columns).toEqual([
      { name: 'city', type: 'VARCHAR' },
      { name: 'n', type: 'INTEGER' },
    ]);
    expect(second.table.toArray().map((row) => row.n)).toEqual([2]);
  });

  it('describes again when the table it reads is a new version', async () => {
    const { spy, describes } = counting();
    await runPanelQuery(spy, `SELECT city FROM "cities_v1" WHERE city = 'Quito'`);
    await runPanelQuery(spy, `SELECT city FROM "cities_v2" WHERE city = 'Quito'`);
    expect(describes()).toBe(2);
  });

  it('still applies ad hoc filters and casts with the columns it remembered', async () => {
    const { spy, describes } = counting();
    const sql = (city: string) => `SELECT city, n::HUGEINT AS big FROM cities WHERE city <> '${city}'`;
    await runPanelQuery(spy, sql('Loja'));
    const second = await runPanelQuery(spy, sql('Cuenca'), {
      filters: [{ key: 'city', operator: '=', value: 'Quito' }],
    });
    expect(describes()).toBe(1);
    expect(second.executed).toContain(`WHERE "city" = 'Quito'`);
    expect(second.executed).toContain('CAST("big" AS DOUBLE)');
    expect(second.table.toArray().map((row) => row.big)).toEqual([1, 3]);
  });

  it('recovers when an unaliased literal names a column the wrapper refers to', async () => {
    const { spy, describes } = counting();
    const sql = (city: string) => `SELECT sum(n) FILTER (WHERE city = '${city}') FROM cities`;
    await runPanelQuery(spy, sql('Quito'));
    const second = await runPanelQuery(spy, sql('Cuenca'));
    expect(describes()).toBe(2);
    expect(fieldNames(second)).toEqual([`sum(n) FILTER (WHERE (city = 'Cuenca'))`]);
    expect(second.table.get(0)?.toArray()).toEqual([2]);
  });

  it('recovers when an unaliased literal names a column the wrapper never touches', async () => {
    const { spy, describes } = counting();
    await runPanelQuery(spy, "SELECT 'abc', n FROM cities ORDER BY n");
    const second = await runPanelQuery(spy, "SELECT 'def', n FROM cities ORDER BY n");
    expect(fieldNames(second)).toEqual(["'def'", 'n']);
    expect(second.columns.map((c) => c.name)).toEqual(["'def'", 'n']);
    expect(second.table.toArray().map((row) => row.n)).toEqual([1, 2, 3]);
    expect(describes()).toBe(2);
  });

  it('stops reusing columns for a statement whose columns follow its values', async () => {
    const { spy, sent } = counting();
    await runPanelQuery(spy, "SELECT 'abc', n FROM cities");
    await runPanelQuery(spy, "SELECT 'def', n FROM cities");
    const before = sent.length;
    await runPanelQuery(spy, "SELECT 'ghi', n FROM cities");
    expect(sent.slice(before).map((sql) => sql.split(' ')[0])).toEqual(['DESCRIBE', 'SELECT']);
  });

  it('notices a type change that the remembered cast would hide', async () => {
    const { spy } = counting();
    const sql = (field: string) =>
      `SELECT struct_extract({'i': INTERVAL 1 DAY, 'd': DATE '2026-09-21'}, '${field}') AS x`;
    await runPanelQuery(spy, sql('i'));
    const second = await runPanelQuery(spy, sql('d'));
    expect(second.columns).toEqual([{ name: 'x', type: 'DATE' }]);
    expect(String(second.table.schema.fields[0].type)).toBe('Date32<DAY>');
    expect(second.executed).toBe(sql('d'));
  });

  it('notices a type change that needs a cast the remembered columns lack', async () => {
    const { spy } = counting();
    const sql = (field: string) => `SELECT struct_extract({'n': 1, 'h': 2::HUGEINT}, '${field}') AS x`;
    await runPanelQuery(spy, sql('n'));
    const second = await runPanelQuery(spy, sql('h'));
    expect(second.executed).toContain('CAST("x" AS DOUBLE)');
    expect(second.table.get(0)?.x).toBe(2);
  });

  it('notices a binary column turning into another type Arrow also carries as binary', async () => {
    const { spy } = counting();
    const sql = (field: string) => `SELECT struct_extract({'b': 'ab'::BLOB, 't': '0101'::BIT}, '${field}') AS x`;
    await runPanelQuery(spy, sql('b'));
    const second = await runPanelQuery(spy, sql('t'));
    expect(second.executed).toContain('CAST("x" AS VARCHAR)');
    expect(second.table.get(0)?.x).toBe('0101');
  });

  it('checks the columns again when an empty result cannot vouch for them, without running it again', async () => {
    const { spy, sent, describes } = counting();
    const sql = (city: string) => `SELECT n::HUGEINT AS big FROM cities WHERE city = '${city}'`;
    await runPanelQuery(spy, sql('Quito'));
    const before = sent.length;
    const empty = await runPanelQuery(spy, sql('Nowhere'));
    // The reuse, then DESCRIBE: the fresh wrapper would be the same query minus
    // the assertion DESCRIBE has just shown holds, so it isn't run a second time.
    expect(sent.slice(before).map((s) => s.split(' ')[0])).toEqual(['SELECT', 'DESCRIBE']);
    expect(describes()).toBe(2);
    expect(empty.table.numRows).toBe(0);
    expect(fieldNames(empty)).toEqual(['big']);
    expect(String(empty.table.schema.fields[0].type)).toBe('Float64');
    expect(empty.columns).toEqual([{ name: 'big', type: 'HUGEINT' }]);
    expect(empty.executed).toContain('CAST("big" AS DOUBLE)');
    // Still remembered: the next run with rows is a plain reuse.
    const again = await runPanelQuery(spy, sql('Cuenca'));
    expect(describes()).toBe(2);
    expect(again.table.toArray().map((row) => row.big)).toEqual([2]);
  });

  it('runs afresh when the columns an empty result could not vouch for have changed', async () => {
    const { spy, sent } = counting();
    const sql = (f: string, city: string) =>
      `SELECT struct_extract({'h': n::HUGEINT, 'm': n::DECIMAL(9,2)}, '${f}') AS x FROM cities WHERE city = '${city}'`;
    await runPanelQuery(spy, sql('h', 'Quito'));
    const before = sent.length;
    const empty = await runPanelQuery(spy, sql('m', 'Nowhere'));
    expect(sent.slice(before).map((s) => s.split(' ')[0])).toEqual(['SELECT', 'DESCRIBE', 'SELECT']);
    expect(empty.columns).toEqual([{ name: 'x', type: 'DECIMAL(9,2)' }]);
    expect(empty.executed).not.toContain('typeof');
    expect(empty.table.numRows).toBe(0);
    expect(String(empty.table.schema.fields[0].type)).toBe('Float64');
  });

  it('fails a wrong query with the error it gives today', async () => {
    const { spy } = counting();
    const sql = (value: string) => `SELECT CAST('${value}' AS INTEGER) AS v`;
    await runPanelQuery(spy, sql('1'));
    const today = await runPanelQuery(counting().spy, sql('abc')).catch((error: Error) => error.message);
    expect(today).toMatch(/Could not convert string 'abc'/);
    await expect(runPanelQuery(spy, sql('abc'))).rejects.toThrow(today as string);
    await expect(runPanelQuery(spy, 'SELECT * FROM nowhere')).rejects.toThrow('Table with name nowhere does not exist');
  });

  it('does not try again once the request was cancelled', async () => {
    const sent: string[] = [];
    const cancelling: SqlRunner = {
      ...runner,
      query: async (sql: string, signal?: AbortSignal) => {
        sent.push(sql);
        if (signal?.aborted) {
          throw new DOMException('The query was cancelled', 'AbortError');
        }
        return runner.query(sql);
      },
    };
    await runPanelQuery(cancelling, "SELECT city FROM cities WHERE city = 'Quito'");
    const controller = new AbortController();
    controller.abort();
    const before = sent.length;
    await expect(
      runPanelQuery(cancelling, "SELECT city FROM cities WHERE city = 'Cuenca'", { signal: controller.signal })
    ).rejects.toThrow('The query was cancelled');
    expect(sent.slice(before)).toEqual(["SELECT city FROM cities WHERE city = 'Cuenca'"]);
  });
});
