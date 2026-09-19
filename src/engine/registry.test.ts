/** @jest-environment node */
import { Float64, Table, vectorFromArray } from 'apache-arrow';

import { DatasetRegistry } from './registry';
import { shortHash } from './sql';
import { createNodeRunner } from './testing/nodeRunner';
import type { SqlRunner } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const arrowOf = (values: number[]) => new Table({ n: vectorFromArray(values, new Float64()) });
const sqlLoader = (rows: number) => ({ kind: 'sql' as const, sql: `SELECT range AS n FROM range(${rows});` });
const exists = async (runner: SqlRunner, table: string) =>
  (await runner.query(`SELECT count(*)::DOUBLE AS c FROM duckdb_tables() WHERE table_name = '${table}'`)).get(0)?.c === 1;

let runner: SqlRunner;
let clock: number;
let registry: DatasetRegistry;

beforeEach(async () => {
  runner = await createNodeRunner();
  clock = 1_000;
  registry = new DatasetRegistry(runner, () => clock);
});

describe('DatasetRegistry', () => {
  it('materializes a dataset as a versioned table and reports its rows', async () => {
    const state = await registry.load('dash', 'vehicles', sqlLoader(3), 'a');
    expect(state).toEqual({
      dashboard: 'dash',
      name: 'vehicles',
      table: `d${shortHash('dash')}_vehicles_v1`,
      version: 1,
      loadedAt: 1_000,
      rows: 3,
    });
    expect(registry.get('dash', 'vehicles')).toEqual(state);
    expect(await exists(runner, state.table)).toBe(true);
  });

  it('keeps the current and the previous version, and drops older ones', async () => {
    const v1 = await registry.load('dash', 'v', sqlLoader(1), 's1');
    const v2 = await registry.load('dash', 'v', sqlLoader(2), 's2');
    expect(await exists(runner, v1.table)).toBe(true);
    const v3 = await registry.load('dash', 'v', sqlLoader(3), 's3');
    expect(v3.version).toBe(3);
    expect(await exists(runner, v1.table)).toBe(false);
    expect(await exists(runner, v2.table)).toBe(true);
    expect(registry.byTable(v2.table)?.table).toBe(v3.table);
    expect(registry.byTable(v1.table)).toBeUndefined();
  });

  it('shares one load between callers with the same signature', async () => {
    const gate = deferred<Table>();
    const fetch = jest.fn(() => gate.promise);
    const first = registry.load('dash', 'v', { kind: 'arrow', fetch }, 'same');
    const second = registry.load('dash', 'v', { kind: 'arrow', fetch }, 'same');
    expect(second).toBe(first);
    gate.resolve(arrowOf([1, 2]));
    expect((await first).rows).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lets a newer load win even when an older one finishes last', async () => {
    const older = deferred<Table>();
    const newer = deferred<Table>();
    const a = registry.load('dash', 'v', { kind: 'arrow', fetch: () => older.promise }, 'range-1');
    const b = registry.load('dash', 'v', { kind: 'arrow', fetch: () => newer.promise }, 'range-2');
    newer.resolve(arrowOf([1, 2, 3]));
    const newest = await b;
    older.resolve(arrowOf([1]));
    const late = await a;
    expect(late).toEqual(newest);
    expect(registry.get('dash', 'v')?.version).toBe(2);
    expect(await exists(runner, `d${shortHash('dash')}_v_v1`)).toBe(false);
  });

  it('serves the previous version, marked stale, when a reload fails', async () => {
    const good = await registry.load('dash', 'v', sqlLoader(2), 'ok');
    clock = 5_000;
    const failed = await registry.load('dash', 'v', { kind: 'sql', sql: 'SELECT * FROM nowhere' }, 'bad');
    expect(failed.table).toBe(good.table);
    expect(failed.stale).toEqual({ error: expect.stringContaining('nowhere'), failedAt: 5_000 });
    const recovered = await registry.load('dash', 'v', sqlLoader(4), 'ok-again');
    expect(recovered.stale).toBeUndefined();
    expect(recovered.rows).toBe(4);
  });

  it('rejects when the first load fails', async () => {
    await expect(registry.load('dash', 'v', { kind: 'sql', sql: 'SELECT * FROM nowhere' }, 'x')).rejects.toThrow(
      'nowhere'
    );
    expect(registry.get('dash', 'v')).toBeUndefined();
  });

  it('keeps another dashboard’s tables when only two are in play', async () => {
    await registry.activate('one');
    const a = await registry.load('one', 'v', sqlLoader(1), 'a');
    await registry.activate('two');
    expect(await exists(runner, a.table)).toBe(true);
    expect(registry.list('one')).toEqual([a]);
    const b = await registry.load('two', 'v', sqlLoader(1), 'b');
    expect(registry.list('two')).toEqual([b]);
  });

  it('keeps a recently used dashboard’s tables when switching back and forth', async () => {
    await registry.activate('a');
    const a = await registry.load('a', 'v', sqlLoader(1), 'a1');
    await registry.activate('b');
    await registry.load('b', 'v', sqlLoader(1), 'b1');
    await registry.activate('a');
    expect(await exists(runner, a.table)).toBe(true);
    expect(registry.get('a', 'v')).toEqual(a);
  });

  it('drops the least recently used dashboard beyond three', async () => {
    await registry.activate('a');
    const a = await registry.load('a', 'v', sqlLoader(1), 'a1');
    await registry.activate('b');
    const b = await registry.load('b', 'v', sqlLoader(1), 'b1');
    await registry.activate('c');
    const c = await registry.load('c', 'v', sqlLoader(1), 'c1');
    await registry.activate('d');
    const d = await registry.load('d', 'v', sqlLoader(1), 'd1');
    expect(await exists(runner, a.table)).toBe(false);
    expect(registry.list('a')).toEqual([]);
    expect(await exists(runner, b.table)).toBe(true);
    expect(await exists(runner, c.table)).toBe(true);
    expect(await exists(runner, d.table)).toBe(true);
    expect(registry.get('b', 'v')).toEqual(b);
    expect(registry.get('c', 'v')).toEqual(c);
    expect(registry.get('d', 'v')).toEqual(d);
  });

  it('moves a reactivated dashboard to the front, so it is not the one evicted', async () => {
    await registry.activate('a');
    const a = await registry.load('a', 'v', sqlLoader(1), 'a1');
    await registry.activate('b');
    const b = await registry.load('b', 'v', sqlLoader(1), 'b1');
    await registry.activate('c');
    await registry.load('c', 'v', sqlLoader(1), 'c1');
    await registry.activate('a'); // 'a' is most recently used again
    await registry.activate('d');
    await registry.load('d', 'v', sqlLoader(1), 'd1');
    // 'b' is now the least recently used, so it is the one evicted, not 'a'.
    expect(await exists(runner, a.table)).toBe(true);
    expect(await exists(runner, b.table)).toBe(false);
    expect(registry.get('a', 'v')).toEqual(a);
    expect(registry.list('b')).toEqual([]);
  });

  it('materializes an empty Arrow table', async () => {
    const state = await registry.load('dash', 'empty', { kind: 'arrow', fetch: async () => arrowOf([]) }, 'e');
    expect(state.rows).toBe(0);
  });

  it('an older load failing after a newer success leaves the good state alone', async () => {
    const older = deferred<Table>();
    const newer = deferred<Table>();
    const a = registry.load('dash', 'v', { kind: 'arrow', fetch: () => older.promise }, 'range-1');
    const b = registry.load('dash', 'v', { kind: 'arrow', fetch: () => newer.promise }, 'range-2');
    newer.resolve(arrowOf([1, 2, 3]));
    const good = await b;
    older.reject(new Error('boom'));
    await a;
    const state = registry.get('dash', 'v');
    expect(state?.stale).toBeUndefined();
    expect(state?.table).toBe(good.table);
    expect(await exists(runner, `d${shortHash('dash')}_v_v1`)).toBe(false);
  });

  it('an orphan load from before its dashboard is evicted never replaces the fresh state', async () => {
    await registry.activate('dash');
    const gate = deferred<Table>();
    const a = registry.load('dash', 'v', { kind: 'arrow', fetch: () => gate.promise }, 'old');
    // Three other dashboards push 'dash' past KEEP_DASHBOARDS, evicting its entry
    // (a plain switch to one other dashboard, within the LRU budget, would not).
    await registry.activate('other1');
    await registry.activate('other2');
    await registry.activate('other3');
    await registry.activate('dash');
    const b = await registry.load('dash', 'v', sqlLoader(2), 'new');
    gate.resolve(arrowOf([1, 2, 3, 4, 5]));
    await a;
    const state = registry.get('dash', 'v');
    expect(state?.table).toBe(b.table);
    expect(state?.rows).toBe(b.rows);
    expect(await exists(runner, `d${shortHash('dash')}_v_v1`)).toBe(false);
  });

  it('an orphan load that fails after its dashboard is evicted taints nothing', async () => {
    await registry.activate('dash');
    const gate = deferred<Table>();
    const a = registry.load('dash', 'v', { kind: 'arrow', fetch: () => gate.promise }, 'old');
    await registry.activate('other1');
    await registry.activate('other2');
    await registry.activate('other3');
    await registry.activate('dash');
    const b = await registry.load('dash', 'v', sqlLoader(2), 'new');
    gate.reject(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    const state = registry.get('dash', 'v');
    expect(state).toEqual(b);
    expect(state?.stale).toBeUndefined();
    expect(await exists(runner, `d${shortHash('dash')}_v_v1`)).toBe(false);
  });
});
