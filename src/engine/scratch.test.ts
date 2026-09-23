/** @jest-environment node */
import { Table } from 'apache-arrow';

import { ScratchPool } from './scratch';
import { createNodeRunner } from './testing/nodeRunner';
import type { SqlRunner, SqlSession } from './types';

const tablesIn = async (runner: SqlRunner, schema: string) =>
  (await runner.query(`SELECT table_name FROM duckdb_tables() WHERE schema_name = '${schema}' ORDER BY 1`))
    .toArray()
    .map((row) => String(row.table_name));

describe('ScratchPool on DuckDB', () => {
  let runner: SqlRunner;
  beforeEach(async () => {
    runner = await createNodeRunner();
    await runner.exec('CREATE SCHEMA datasets; CREATE TABLE main.keep AS SELECT 1 AS n');
    await runner.exec('CREATE VIEW datasets.sample AS SELECT range AS n FROM range(5)');
  });

  it('writes unqualified tables to explore and reads datasets by bare name', async () => {
    const pool = new ScratchPool(runner);
    await pool.query('CREATE TABLE hot AS SELECT * FROM sample WHERE n > 2');
    expect(await tablesIn(runner, 'explore')).toEqual(['hot']);
    expect((await pool.query('SELECT count(*)::DOUBLE AS c FROM hot')).get(0)?.c).toBe(2);
  });

  it('empties explore, leaves main and datasets alone, and keeps its connections working', async () => {
    const pool = new ScratchPool(runner);
    await pool.query('CREATE TABLE hot AS SELECT 1 AS n');
    await pool.releaseScratch();
    expect(await tablesIn(runner, 'explore')).toEqual([]);
    expect(await tablesIn(runner, 'main')).toEqual(['keep']);
    expect((await runner.query('SELECT count(*)::DOUBLE AS c FROM datasets.sample')).get(0)?.c).toBe(5);
    await pool.query('CREATE TABLE again AS SELECT 2 AS n');
    expect(await tablesIn(runner, 'explore')).toEqual(['again']);
  });

  it('keeps explore when a release drops it but fails to recreate it', async () => {
    const halfFailing: SqlRunner = {
      ...runner,
      async exec(sql) {
        if (sql.startsWith('DROP SCHEMA IF EXISTS explore')) {
          await runner.exec('DROP SCHEMA IF EXISTS explore CASCADE');
          throw new Error('create failed');
        }
        return runner.exec(sql);
      },
    };
    const pool = new ScratchPool(halfFailing);
    await pool.query('CREATE TABLE hot AS SELECT 1 AS n');
    await expect(pool.releaseScratch()).rejects.toThrow('create failed');
    const schemas = await runner.query("SELECT count(*)::DOUBLE AS c FROM duckdb_schemas() WHERE schema_name = 'explore'");
    expect(schemas.get(0)?.c).toBe(1);
    await pool.query('CREATE TABLE again AS SELECT 2 AS n');
    expect(await tablesIn(runner, 'explore')).toEqual(['again']);
  });
});

describe('ScratchPool connections', () => {
  function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => (release = resolve));
    return { promise, release };
  }

  /** A runner whose sessions hold every query until released, and count how many were opened. */
  function holdingRunner() {
    const gates: Array<() => void> = [];
    let opened = 0;
    const runner: SqlRunner = {
      query: async () => new Table(),
      exec: async () => undefined,
      insertArrow: async () => undefined,
      openSession: async (): Promise<SqlSession> => {
        opened++;
        return {
          query: async () => {
            const gate = deferred();
            gates.push(gate.release);
            await gate.promise;
            return new Table();
          },
          close: async () => undefined,
        };
      },
    };
    return { runner, gates, opened: () => opened };
  }

  it('opens at most `size` connections and queues the rest', async () => {
    const { runner, gates, opened } = holdingRunner();
    const pool = new ScratchPool(runner, 2);
    const queries = [pool.query('a'), pool.query('b'), pool.query('c')];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened()).toBe(2);
    expect(gates).toHaveLength(2);
    gates[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(opened()).toBe(2);
    expect(gates).toHaveLength(3);
    gates[1]();
    gates[2]();
    await Promise.all(queries);
  });

  it('rejects a queued query whose signal aborts, and does not lose the connection', async () => {
    const { runner, gates, opened } = holdingRunner();
    const pool = new ScratchPool(runner, 1);
    const first = pool.query('a');
    const controller = new AbortController();
    const queued = pool.query('b', controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    gates[0]();
    await first;
    const third = pool.query('c');
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates[1]();
    await third;
    expect(opened()).toBe(1);
  });

  it('says clearly when the runner cannot open connections', async () => {
    const runner: SqlRunner = { query: async () => new Table(), exec: async () => undefined, insertArrow: async () => undefined };
    await expect(new ScratchPool(runner).query('SELECT 1')).rejects.toThrow('cannot open explorer connections');
  });

  /** A runner whose openSession fails on its first `failCount` calls, then succeeds. Counts every call. */
  function flakyRunner(failCount: number) {
    let opens = 0;
    let failuresLeft = failCount;
    const runner: SqlRunner = {
      query: async () => new Table(),
      exec: async () => undefined,
      insertArrow: async () => undefined,
      openSession: async (): Promise<SqlSession> => {
        opens++;
        if (failuresLeft > 0) {
          failuresLeft--;
          throw new Error('boom');
        }
        return { query: async () => new Table(), close: async () => undefined };
      },
    };
    return { runner, opens: () => opens };
  }

  it('opens a fresh connection for a queued query after an earlier open fails', async () => {
    const { runner, opens } = flakyRunner(1);
    const pool = new ScratchPool(runner, 1);
    const first = pool.query('a');
    const second = pool.query('b');
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBeInstanceOf(Table);
    expect(opens()).toBe(2);
  });

  it('rejects every queued query when opening keeps failing, and recovers afterward', async () => {
    const { runner, opens } = flakyRunner(3);
    const pool = new ScratchPool(runner, 1);
    const first = pool.query('a');
    const second = pool.query('b');
    const third = pool.query('c');
    await expect(first).rejects.toThrow('boom');
    await expect(second).rejects.toThrow('boom');
    await expect(third).rejects.toThrow('boom');
    expect(opens()).toBe(3);

    // The pool's internal bookkeeping is not corrupted by the run of failures:
    // one more query, now that opening succeeds, triggers exactly one more openSession call.
    await pool.query('d');
    expect(opens()).toBe(4);
  });

  it('returns a session to the pool after its query throws, and reuses it', async () => {
    let opens = 0;
    const runner: SqlRunner = {
      query: async () => new Table(),
      exec: async () => undefined,
      insertArrow: async () => undefined,
      openSession: async (): Promise<SqlSession> => {
        opens++;
        return {
          query: async (sql: string) => {
            if (sql === 'bad') {
              throw new Error('syntax error');
            }
            return new Table();
          },
          close: async () => undefined,
        };
      },
    };
    const pool = new ScratchPool(runner, 1);
    await expect(pool.query('bad')).rejects.toThrow('syntax error');
    await pool.query('good');
    expect(opens).toBe(1);
  });
});
