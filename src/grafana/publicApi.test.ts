/** @jest-environment node */
import { tableFromIPC } from 'apache-arrow';

import { DatasetRegistry } from '../engine/registry';
import { createNodeRunner } from '../engine/testing/nodeRunner';
import type { SqlRunner } from '../engine/types';
import {
  type ChangeEvent,
  type ChaskiEngineApi,
  type ChaskiGlobal,
  createEngineApi,
  installChaskiGlobal,
  publishEngineApi,
} from './publicApi';

const sqlLoader = (rows: number) => ({ kind: 'sql' as const, sql: `SELECT range AS n FROM range(${rows})` });
const next = (api: ChaskiEngineApi, kind: ChangeEvent['kind']) =>
  new Promise<ChangeEvent>((resolve) => {
    const stop = api.onChange((event) => {
      if (event.kind === kind) {
        stop();
        resolve(event);
      }
    });
  });
/** The Node runner, with every exec recorded and optionally delayed or failed first by `before`. */
const recording = (inner: SqlRunner, before: (sql: string) => Promise<void> = async () => undefined) => {
  const execs: string[] = [];
  const wrapped: SqlRunner = {
    ...inner,
    async exec(sql) {
      execs.push(sql);
      await before(sql);
      return inner.exec(sql);
    },
  };
  return { runner: wrapped, execs };
};
const apiOn = (wrapped: SqlRunner, on: DatasetRegistry) =>
  createEngineApi({ runner: wrapped, registry: on, version: 'v1.4.3', track: (work) => work() });
const rowsOf = async (api: ChaskiEngineApi, sql: string) => tableFromIPC(await api.queryIPC(sql)).toArray();

let runner: SqlRunner;
let registry: DatasetRegistry;
let tracked: number;
let api: ChaskiEngineApi;

beforeEach(async () => {
  runner = await createNodeRunner();
  registry = new DatasetRegistry(runner);
  tracked = 0;
  api = createEngineApi({
    runner,
    registry,
    version: 'v1.4.3',
    track: (work) => {
      tracked++;
      return work();
    },
  });
});

describe('window.__chaski', () => {
  it('pins the v1 entry point: no engine until one is published', async () => {
    const target: { __chaski?: ChaskiGlobal } = {};
    installChaskiGlobal(target);
    expect(target.__chaski?.apiVersion).toBe(1);
    publishEngineApi(undefined);
    expect(target.__chaski?.engine()).toBeUndefined();
    const published = Promise.resolve(api);
    publishEngineApi(published);
    expect(target.__chaski?.engine()).toBe(published);
    expect(target.__chaski?.engine()).toBe(target.__chaski?.engine());
    publishEngineApi(undefined);
  });

  it('pins the v1 methods', () => {
    expect(Object.keys(api).sort()).toEqual(
      ['datasets', 'duckdbVersion', 'exec', 'onChange', 'queryIPC', 'releaseScratch'].sort()
    );
    expect(api.duckdbVersion).toBe('v1.4.3');
  });
});

describe('the engine API', () => {
  it('announces a dataset once its view reads the new version', async () => {
    await registry.activate('d');
    const heard = next(api, 'dataset');
    // Read through the view the moment the event fires: it must already show the new version.
    let rowsAtEvent: Promise<number> | undefined;
    api.onChange((event) => {
      if (event.kind === 'dataset') {
        rowsAtEvent = rowsOf(api, 'SELECT count(*)::DOUBLE AS c FROM sample').then((rows) => rows[0].c);
      }
    });
    await registry.load('d', 'sample', sqlLoader(3), 's1');
    expect(await heard).toEqual({ kind: 'dataset', name: 'sample', view: 'datasets."sample"' });
    expect(await rowsAtEvent).toBe(3);
    expect(api.datasets()).toEqual([
      expect.objectContaining({ name: 'sample', view: 'datasets."sample"', rows: 3, table: registry.get('d', 'sample')!.table }),
    ]);
  });

  it('runs explorer work on explore without counting it, and panel work on the panels path counting it', async () => {
    await registry.activate('d');
    const ready = next(api, 'dataset');
    await registry.load('d', 'sample', sqlLoader(2), 's1');
    await ready;
    await api.exec('CREATE TABLE hot AS SELECT * FROM sample');
    expect(tracked).toBe(0);
    const where = await runner.query("SELECT schema_name FROM duckdb_tables() WHERE table_name = 'hot'");
    expect(where.get(0)?.schema_name).toBe('explore');
    const viaPanel = tableFromIPC(
      await api.queryIPC('SELECT count(*)::DOUBLE AS c FROM datasets.sample', { consumer: 'panel' })
    );
    expect(viaPanel.get(0)?.c).toBe(2);
    expect(tracked).toBe(1);
  });

  it('keeps Timestamp, Decimal and binary types across IPC', async () => {
    const table = tableFromIPC(
      await api.queryIPC("SELECT TIMESTAMP '2026-01-02 03:04:05' AS t, 1.25::DECIMAL(10,2) AS d, '\\xAA\\xBB'::BLOB AS b")
    );
    const types = Object.fromEntries(table.schema.fields.map((f) => [f.name, String(f.type)]));
    expect(types.t).toMatch(/^Timestamp/);
    expect(types.d).toMatch(/^Decimal/);
    expect(types.b).toBe('Binary');
  });

  it('empties explore and re-points views when another dashboard comes to the front', async () => {
    await registry.activate('a');
    const ready = next(api, 'dataset');
    await registry.load('a', 'sample', sqlLoader(2), 's1');
    await ready;
    await api.exec('CREATE TABLE hot AS SELECT 1 AS n');
    const switched = next(api, 'dashboard');
    await registry.activate('b');
    expect(await switched).toEqual({ kind: 'dashboard', dashboard: 'b' });
    const left = await runner.query(
      "SELECT count(*)::DOUBLE AS c FROM duckdb_tables() WHERE schema_name = 'explore'"
    );
    expect(left.get(0)?.c).toBe(0);
    const views = await runner.query("SELECT count(*)::DOUBLE AS c FROM duckdb_views() WHERE schema_name = 'datasets'");
    expect(views.get(0)?.c).toBe(0);
    expect(api.datasets()).toEqual([]);
  });

  it('does not re-point views for a dataset adopted on a dashboard that is not on screen', async () => {
    await registry.activate('a');
    const ready = next(api, 'dataset');
    await registry.load('a', 'sample', sqlLoader(2), 's1');
    await ready;
    const switched = next(api, 'dashboard');
    await registry.activate('b');
    await switched;
    const heard: ChangeEvent[] = [];
    api.onChange((event) => heard.push(event));
    await registry.load('a', 'sample', sqlLoader(5), 's2');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toEqual([]);
    const views = await runner.query("SELECT count(*)::DOUBLE AS c FROM duckdb_views() WHERE schema_name = 'datasets'");
    expect(views.get(0)?.c).toBe(0);
  });

  it('reports a dataset whose latest reload failed as stale', async () => {
    await registry.activate('d');
    await registry.load('d', 'sample', sqlLoader(2), 's1');
    await registry.load('d', 'sample', { kind: 'sql', sql: 'SELECT * FROM missing_table' }, 's2');
    expect(api.datasets()[0].stale).toMatch(/missing_table/);
  });

  it('empties explore on request', async () => {
    await api.exec('CREATE TABLE hot AS SELECT 1 AS n');
    await api.releaseScratch();
    const left = await runner.query("SELECT count(*)::DOUBLE AS c FROM duckdb_tables() WHERE schema_name = 'explore'");
    expect(left.get(0)?.c).toBe(0);
  });

  it('delivers events in the order the registry produced them, across a switch', async () => {
    // A slow release makes the dashboard step finish after the load for b adopts.
    const { runner: slow } = recording(runner, (sql) =>
      sql.startsWith('DROP SCHEMA IF EXISTS explore')
        ? new Promise((resolve) => setTimeout(resolve, 50))
        : Promise.resolve()
    );
    const reg = new DatasetRegistry(runner);
    const sut = apiOn(slow, reg);
    await reg.activate('a');
    const ready = next(sut, 'dataset');
    await reg.load('a', 'sample', sqlLoader(2), 's1');
    await ready;
    const heard: ChangeEvent[] = [];
    sut.onChange((event) => heard.push(event));
    const landed = next(sut, 'dataset');
    await Promise.all([reg.activate('b'), reg.load('b', 'sample', sqlLoader(3), 's1')]);
    await landed;
    expect(heard).toEqual([
      { kind: 'dashboard', dashboard: 'b' },
      { kind: 'dataset', name: 'sample', view: 'datasets."sample"' },
    ]);
    expect((await rowsOf(sut, 'SELECT count(*)::DOUBLE AS c FROM datasets.sample'))[0].c).toBe(3);
  });

  it('announces no dataset whose view could not be created', async () => {
    const { runner: flaky } = recording(runner, async (sql) => {
      if (sql.startsWith('CREATE OR REPLACE VIEW datasets."broken"')) {
        throw new Error('no view for you');
      }
    });
    const reg = new DatasetRegistry(runner);
    const sut = apiOn(flaky, reg);
    const heard: ChangeEvent[] = [];
    sut.onChange((event) => heard.push(event));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await reg.activate('d');
      await reg.load('d', 'broken', sqlLoader(1), 's1');
      // Events arrive in registry order, so once `other` is heard, `broken` had its turn.
      const later = next(sut, 'dataset');
      await reg.load('d', 'other', sqlLoader(1), 's1');
      await later;
      expect(heard).toEqual([
        { kind: 'dashboard', dashboard: 'd' },
        { kind: 'dataset', name: 'other', view: 'datasets."other"' },
      ]);
      expect(warn).toHaveBeenCalledWith('Chaski: dataset view', expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  it('creates one view per load, not one per dataset on the dashboard', async () => {
    const { runner: counted, execs } = recording(runner);
    const reg = new DatasetRegistry(runner);
    const sut = apiOn(counted, reg);
    await reg.activate('d');
    for (const name of ['x', 'y', 'z']) {
      const ready = next(sut, 'dataset');
      await reg.load('d', name, sqlLoader(2), 's1');
      await ready;
    }
    execs.length = 0;
    const ready = next(sut, 'dataset');
    await reg.load('d', 'y', sqlLoader(4), 's2');
    await ready;
    expect(execs.filter((sql) => sql.startsWith('CREATE OR REPLACE VIEW'))).toEqual([
      `CREATE OR REPLACE VIEW datasets."y" AS SELECT * FROM main."${reg.get('d', 'y')!.table}"`,
    ]);
  });
});
