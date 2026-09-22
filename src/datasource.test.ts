/** @jest-environment jsdom */
import {
  type DataQueryRequest,
  type DataQueryResponse,
  type DataSourceInstanceSettings,
  dateTime,
  EventBusSrv,
} from '@grafana/data';
import type { DataQuery } from '@grafana/schema';
import { lastValueFrom } from 'rxjs';

import { DataSource } from './datasource';
import { DatasetRegistry } from './engine/registry';
import { stats } from './engine/stats';
import { createNodeRunner } from './engine/testing/nodeRunner';
import type { SqlRunner } from './engine/types';
import { leaveDashboardOnNavigation } from './grafana/dashboardKey';
import { setEngineForTests } from './grafana/engine';
import { fakeTemplateSrv, makeRequest } from './grafana/testing/fakes';
import { DuckdbWasmActivityEvent } from './grafana/activity';
import type { DuckOptions, DuckQuery, DuckVariableQuery } from './types';

const mockTemplateSrv = { current: fakeTemplateSrv({}) };
const mockSourceQuery = jest.fn((..._args: unknown[]): unknown => ({ data: [] }));
const mockBus = new EventBusSrv();
/** Grafana's history listeners; `navigate` below plays a navigation to them. */
const mockHistoryListeners = new Set<(location: { pathname: string }) => void>();

jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: () => mockTemplateSrv.current,
  getDataSourceSrv: () => ({
    get: async () => ({ name: 'upstream', query: (...args: unknown[]) => mockSourceQuery(...args) }),
  }),
  locationService: {
    getLocation: () => ({ pathname: '/d/dash1/test' }),
    getHistory: () => ({
      listen: (listener: (location: { pathname: string }) => void) => {
        mockHistoryListeners.add(listener);
        return () => mockHistoryListeners.delete(listener);
      },
    }),
  },
  getAppEvents: () => mockBus,
}));
// The real editor pulls in @grafana/ui, which needs a DOM.
jest.mock('./components/VariableQueryEditor', () => ({ VariableQueryEditor: () => null }));

const settings = {
  id: 1,
  uid: 'duckdbwasm',
  type: 'ubica-chaski-datasource',
  name: 'Chaski',
  jsonData: { memoryLimitMB: 256 },
  meta: {},
  readOnly: false,
  access: 'proxy',
} as unknown as DataSourceInstanceSettings<DuckOptions>;

let runner: SqlRunner;
let registry: DatasetRegistry;
let ds: DataSource;

const CITIES = "SELECT * FROM (VALUES ('Quito', 1), ('Cuenca', 2), ('Quito', 3)) AS t(city, n)";

async function loadDataset(name: string, sql: string) {
  const response = await ds.runVariableQuery(
    makeRequest<DuckVariableQuery>([{ refId: name, kind: 'dataset', name, source: { type: 'sql', sql } }])
  );
  return response.data[0].fields.find((f: { name: string }) => f.name === 'value').values[0] as string;
}

beforeEach(async () => {
  runner = await createNodeRunner();
  registry = new DatasetRegistry(runner);
  setEngineForTests({ runner, registry, version: 'v1.4.3' });
  ds = new DataSource(settings);
});

afterEach(() => setEngineForTests(undefined));

/** Waits up to 3 s for `check` to hold, then lets the test's assertions speak. */
async function until(check: () => boolean) {
  for (let i = 0; i < 300 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('DataSource', () => {
  it('loads a dataset variable and lets panels read it by variable', async () => {
    const table = await loadDataset('cities', CITIES);
    expect(table).toMatch(/^d[0-9a-f]{8}_cities_v1$/);
    mockTemplateSrv.current = fakeTemplateSrv({ cities: table, city: ['Quito'] });
    const response = await lastValueFrom(
      ds.query(
        makeRequest<DuckQuery>([
          { refId: 'A', rawSql: 'SELECT count(*)::DOUBLE AS n FROM $cities WHERE city IN ($city)' },
        ])
      )
    );
    expect(response.errors).toBeUndefined();
    expect(response.data[0].fields[0].values).toEqual([2]);
    expect(response.data[0].meta.executedQueryString).toContain(`FROM "${table}" WHERE city IN ('Quito')`);
  });

  it('applies ad hoc filters locally', async () => {
    const table = await loadDataset('cities', CITIES);
    mockTemplateSrv.current = fakeTemplateSrv({ cities: table });
    const response = await ds.runPanelQueries(
      makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT city, n FROM $cities ORDER BY n' }], {
        filters: [{ key: 'city', operator: '=', value: 'Cuenca' }],
      })
    );
    expect(response.data[0].fields[1].values).toEqual([2]);
  });

  it('warns on frames that read a dataset whose reload failed', async () => {
    const table = await loadDataset('cities', CITIES);
    await loadDataset('cities', 'SELECT * FROM nowhere');
    mockTemplateSrv.current = fakeTemplateSrv({ cities: table });
    const response = await ds.runPanelQueries(makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT * FROM $cities' }]));
    expect(response.data[0].meta.notices[0].text).toMatch(/^cities: data from \d+ s ago — the reload failed/);
  });

  it('explains a missing dataset table', async () => {
    const response = await ds.runPanelQueries(makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT * FROM nope' }]));
    expect(response.errors?.[0]).toEqual({ refId: 'A', message: expect.stringContaining('Is a dataset variable missing') });
  });

  it('skips hidden and empty queries', async () => {
    const response = await ds.runPanelQueries(
      makeRequest<DuckQuery>([
        { refId: 'A', rawSql: '  ' },
        { refId: 'B', rawSql: 'SELECT 1 AS one', hide: true },
      ])
    );
    expect(response.data).toEqual([]);
  });

  it('records the panel id of each answer, for the playback bench to break latency down per panel', async () => {
    stats.queries.length = 0;
    await ds.runPanelQueries(makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT 1 AS one' }], { panelId: 7 }));
    await ds.runPanelQueries(makeRequest<DuckQuery>([{ refId: 'B', rawSql: 'SELECT 1 AS one' }]));
    expect(stats.queries.map((q) => q.panelId)).toEqual([7, undefined]);
  });

  it('answers a values variable with text and value', async () => {
    const table = await loadDataset('cities', CITIES);
    mockTemplateSrv.current = fakeTemplateSrv({ cities: table });
    const response = await ds.runVariableQuery(
      makeRequest<DuckVariableQuery>([
        { refId: 'v', kind: 'values', sql: 'SELECT DISTINCT city, upper(city) FROM $cities ORDER BY 1' },
      ])
    );
    const fields = Object.fromEntries(response.data[0].fields.map((f: { name: string; values: unknown[] }) => [f.name, f.values]));
    expect(fields).toEqual({ text: ['CUENCA', 'QUITO'], value: ['Cuenca', 'Quito'] });
  });

  it('refuses a dataset without a name', async () => {
    await expect(
      ds.runVariableQuery(
        makeRequest<DuckVariableQuery>([{ refId: 'v', kind: 'dataset', name: ' ', source: { type: 'sql', sql: 'SELECT 1' } }])
      )
    ).rejects.toThrow('A dataset variable needs a name');
  });

  it('reports the engine version on Save & test', async () => {
    expect(await ds.testDatasource()).toEqual({ status: 'success', message: 'DuckDB v1.4.3 is running in the browser.' });
  });
});

describe('ad hoc filter options', () => {
  it('offers the columns of the dashboard datasets as keys', async () => {
    await loadDataset('cities', CITIES);
    await loadDataset('other', "SELECT 'x' AS city, 1 AS extra");
    expect(await ds.getTagKeys()).toEqual([{ text: 'city' }, { text: 'extra' }, { text: 'n' }]);
  });

  it('offers the distinct values of a key across datasets', async () => {
    await loadDataset('cities', CITIES);
    await loadDataset('other', "SELECT 'Loja' AS city");
    expect(await ds.getTagValues({ key: 'city', filters: [] })).toEqual([
      { text: 'Cuenca' },
      { text: 'Loja' },
      { text: 'Quito' },
    ]);
    expect(await ds.getTagValues({ key: 'missing', filters: [] })).toEqual([]);
  });

  it('explains a failure in getTagKeys like a panel error', async () => {
    await loadDataset('cities', CITIES);
    setEngineForTests({
      runner: {
        ...runner,
        query: async () => {
          throw new Error('Catalog Error: Table with name x does not exist!');
        },
      },
      registry,
      version: 'v1.4.3',
    });
    await expect(ds.getTagKeys()).rejects.toThrow('Is a dataset variable missing');
  });

  it('explains a missing table in a values variable like a panel error', async () => {
    await expect(
      ds.runVariableQuery(makeRequest<DuckVariableQuery>([{ refId: 'v', kind: 'values', sql: 'SELECT * FROM nope' }]))
    ).rejects.toThrow('Is a dataset variable missing');
  });
});

describe('range reuse', () => {
  const HOUR = 3_600_000;
  const FROM = Date.UTC(2026, 8, 18);
  const TO = Date.UTC(2026, 8, 19);
  const HOURS =
    "SELECT * FROM (SELECT TIMESTAMP '2026-09-18' + to_hours(range) AS t FROM range(24)) WHERE $__timeFilter(t)";

  const absolute = (from: number, to: number): Partial<DataQueryRequest<DuckVariableQuery>> => {
    const f = dateTime(from);
    const t = dateTime(to);
    return { range: { from: f, to: t, raw: { from: f, to: t } } };
  };
  const relative = (from: number, to: number, rawFrom: string): Partial<DataQueryRequest<DuckVariableQuery>> => ({
    range: { from: dateTime(from), to: dateTime(to), raw: { from: rawFrom, to: 'now' } },
  });
  const sqlDataset = (sql: string, extra: Partial<DataQueryRequest<DuckVariableQuery>>) =>
    makeRequest<DuckVariableQuery>(
      [{ refId: 'h', kind: 'dataset', name: 'hours', source: { type: 'sql', sql } }],
      extra
    );
  const tableOf = (response: DataQueryResponse) =>
    response.data[0].fields.find((f: { name: string }) => f.name === 'value').values[0] as string;

  beforeEach(() => {
    stats.reuses.length = 0;
    mockSourceQuery.mockReset();
    mockSourceQuery.mockImplementation(() => ({ data: [] }));
  });

  it('keeps the loaded table on a zoom-in', async () => {
    const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM, TO))));
    const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM + 6 * HOUR, FROM + 12 * HOUR))));
    expect(second).toBe(first);
    expect(stats.reuses.map((r) => r.name)).toEqual(['hours']);
  });

  it('reloads on a zoom-out', async () => {
    const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM + 6 * HOUR, FROM + 12 * HOUR))));
    const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM, TO))));
    expect(second).not.toBe(first);
    expect(stats.reuses).toEqual([]);
  });

  it('reloads on a refresh, which keeps the raw range', async () => {
    const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, relative(FROM, TO, 'now-1d'))));
    const second = tableOf(
      await ds.runVariableQuery(sqlDataset(HOURS, relative(FROM + 60_000, TO + 60_000, 'now-1d')))
    );
    expect(second).not.toBe(first);
  });

  it('keeps the table across presets that both end at now', async () => {
    const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, relative(FROM, TO, 'now-1d'))));
    const later = TO + 60_000;
    const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, relative(later - 6 * HOUR, later, 'now-6h'))));
    expect(second).toBe(first);
  });

  it('reloads when another variable in the source changed', async () => {
    const sql = `${HOURS} AND hour(t) >= $minHour`;
    mockTemplateSrv.current = fakeTemplateSrv({ minHour: '0' });
    const first = tableOf(await ds.runVariableQuery(sqlDataset(sql, absolute(FROM, TO))));
    mockTemplateSrv.current = fakeTemplateSrv({ minHour: '6' });
    const second = tableOf(await ds.runVariableQuery(sqlDataset(sql, absolute(FROM + HOUR, FROM + 2 * HOUR))));
    expect(second).not.toBe(first);
  });

  it('reloads after the dashboard was left and opened again', async () => {
    const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM, TO))));
    await registry.activate('elsewhere');
    const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM + HOUR, FROM + 2 * HOUR))));
    expect(second).not.toBe(first);
  });

  describe('across navigation', () => {
    const navigate = (pathname: string) => mockHistoryListeners.forEach((listener) => listener({ pathname }));
    let stopWatching: () => void;
    beforeEach(() => (stopWatching = leaveDashboardOnNavigation(registry)));
    afterEach(() => stopWatching());

    it('reloads after a trip to a page without this datasource and back', async () => {
      const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM, TO))));
      navigate('/'); // Home: nothing there asks this datasource anything
      navigate('/d/dash1/test');
      const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM + HOUR, FROM + 2 * HOUR))));
      expect(second).not.toBe(first);
      expect(stats.reuses).toEqual([]);
    });

    it('still keeps the table when only the query string moved', async () => {
      const first = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM, TO))));
      navigate('/d/dash1/test');
      const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, absolute(FROM + HOUR, FROM + 2 * HOUR))));
      expect(second).toBe(first);
    });
  });

  it('keeps a table from another datasource whose query reads __from, when only the range moved', async () => {
    mockSourceQuery.mockImplementation(() => ({ data: [{ fields: [{ name: 'n', values: [1, 2] }] }] }));
    const remote = (extra: Partial<DataQueryRequest<DuckVariableQuery>>) =>
      makeRequest<DuckVariableQuery>(
        [
          {
            refId: 'r',
            kind: 'dataset',
            name: 'remote',
            source: {
              type: 'datasource',
              datasource: { uid: 'up', type: 'upstream' },
              query: { refId: 'q', expr: 'since ${__from} until ${__to}' } as DataQuery,
            },
          },
        ],
        extra
      );
    const first = tableOf(await ds.runVariableQuery(remote(absolute(FROM, TO))));
    const second = tableOf(await ds.runVariableQuery(remote(absolute(FROM + HOUR, FROM + 2 * HOUR))));
    expect(second).toBe(first);
    expect(mockSourceQuery).toHaveBeenCalledTimes(1);
  });
});

describe('activity', () => {
  it('announces busy and settled around variable and panel queries', async () => {
    const heard: string[] = [];
    const subscription = mockBus.subscribe(DuckdbWasmActivityEvent, (event) => heard.push(event.payload.state));
    await lastValueFrom(
      ds.variableQuery(
        makeRequest<DuckVariableQuery>([
          { refId: 'c', kind: 'dataset', name: 'cities', source: { type: 'sql', sql: CITIES } },
        ])
      )
    );
    await lastValueFrom(ds.query(makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT 1 AS one' }])));
    subscription.unsubscribe();
    expect(heard).toEqual(['busy', 'settled', 'busy', 'settled']);
  });

  it('settles when Grafana abandons a panel query', async () => {
    const heard: string[] = [];
    const subscription = mockBus.subscribe(DuckdbWasmActivityEvent, (event) => heard.push(event.payload.state));
    const running = ds
      .query(makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT count(*) AS n FROM range(50000000)' }]))
      .subscribe({ error: () => undefined });
    running.unsubscribe();
    await until(() => heard.length === 2);
    subscription.unsubscribe();
    expect(heard).toEqual(['busy', 'settled']);
  });
});

describe('identical panel requests in flight', () => {
  interface Held {
    sql: string;
    signal?: AbortSignal;
    release: () => void;
  }

  /**
   * The Node runner, recording each statement a panel runs and holding it until
   * released, so a test can line requests up while one is in flight. DESCRIBE
   * passes straight through: it takes no signal.
   */
  let releaseAll: (() => void) | undefined;

  function holdingRunner(options: { hold: boolean }) {
    const held: Held[] = [];
    const ran: string[] = [];
    let open = !options.hold;
    const holding: SqlRunner = {
      ...runner,
      query: async (sql, signal) => {
        if (!sql.startsWith('DESCRIBE')) {
          ran.push(sql);
          if (!open) {
            await new Promise<void>((release) => held.push({ sql, signal, release }));
          }
        }
        return runner.query(sql, signal);
      },
    };
    setEngineForTests({ runner: holding, registry, version: 'v1.4.3' });
    releaseAll = () => {
      open = true;
      held.forEach((h) => h.release());
    };
    return { held, ran, openAll: releaseAll };
  }

  function subscribe(request: DataQueryRequest<DuckQuery>) {
    const seen: { response?: DataQueryResponse; error?: unknown; done: boolean } = { done: false };
    const subscription = ds.query(request).subscribe({
      next: (response) => (seen.response = response),
      error: (error: unknown) => {
        seen.error = error;
        seen.done = true;
      },
      complete: () => (seen.done = true),
    });
    return { seen, subscription };
  }

  const panel = (requestId: string, extra: Partial<DataQueryRequest<DuckQuery>> = {}) =>
    makeRequest<DuckQuery>([{ refId: 'A', rawSql: 'SELECT 1 AS one' }], {
      requestId,
      panelId: 3,
      dashboardUID: 'dash',
      ...extra,
    });
  const valuesOf = (response?: DataQueryResponse) =>
    response?.data.map((frame: { fields: Array<{ values: unknown[] }> }) => frame.fields.map((f) => f.values));
  const settled = () => stats.activity.at(-1)?.state === 'settled';

  beforeEach(() => {
    stats.queries.length = 0;
    stats.activity.length = 0;
    stats.shared.length = 0;
  });

  // A failed test must not leave work held, which would keep the page busy for the next.
  afterEach(async () => {
    releaseAll?.();
    releaseAll = undefined;
    await until(() => (stats.activity.at(-1)?.state ?? 'settled') === 'settled');
  });

  it('runs two identical requests once and answers both', async () => {
    const { held, ran, openAll } = holdingRunner({ hold: true });
    const twoTargets = (requestId: string) =>
      makeRequest<DuckQuery>(
        [
          { refId: 'A', rawSql: 'SELECT 1 AS one' },
          { refId: 'B', rawSql: "SELECT 'x' AS x" },
        ],
        { requestId, panelId: 3, dashboardUID: 'dash' }
      );
    const first = lastValueFrom(ds.query(twoTargets('SQR1')));
    const second = lastValueFrom(ds.query(twoTargets('SQR2')));
    await until(() => stats.shared.length === 1 && held.length === 1);
    openAll();
    const [a, b] = await Promise.all([first, second]);

    expect(ran).toEqual(['SELECT 1 AS one', "SELECT 'x' AS x"]);
    expect(stats.queries).toHaveLength(2);
    expect(stats.shared).toEqual([{ panelId: 3, at: expect.any(Number) }]);
    expect(a.errors).toBeUndefined();
    expect(valuesOf(a)).toEqual([[[1]], [['x']]]);
    expect(valuesOf(b)).toEqual(valuesOf(a));
    expect(b.data[0].meta).toEqual(a.data[0].meta);
    // Grafana writes to the frames and fields it gets (field.state, for one), so
    // each request has its own; only the column values are shared.
    expect(b.data[0]).not.toBe(a.data[0]);
    expect(b.data[0].fields[0]).not.toBe(a.data[0].fields[0]);
    expect(b.data[0].fields[0].values).toBe(a.data[0].fields[0].values);
  });

  it.each<[string, Partial<DataQueryRequest<DuckQuery>>, Partial<DataQueryRequest<DuckQuery>>]>([
    [
      'SQL',
      { targets: [{ refId: 'A', rawSql: 'SELECT 1 AS one' }] },
      { targets: [{ refId: 'A', rawSql: 'SELECT 2 AS one' }] },
    ],
    [
      'variable values',
      { targets: [{ refId: 'A', rawSql: 'SELECT $v AS one' }], scopedVars: { v: { text: '1', value: '1' } } },
      { targets: [{ refId: 'A', rawSql: 'SELECT $v AS one' }], scopedVars: { v: { text: '2', value: '2' } } },
    ],
    ['panel', { panelId: 1 }, { panelId: 2 }],
    ['dashboard', { dashboardUID: 'one' }, { dashboardUID: 'two' }],
    ['ad hoc filters', { filters: [{ key: 'one', operator: '=', value: '1' }] }, { filters: [] }],
  ])('runs requests that differ in %s separately', async (_what, one, two) => {
    const { held, openAll } = holdingRunner({ hold: true });
    const first = lastValueFrom(ds.query(panel('SQR1', one)));
    const second = lastValueFrom(ds.query(panel('SQR2', two)));
    await until(() => held.length === 2);
    expect(held).toHaveLength(2);
    openAll();
    await Promise.all([first, second]);
    expect(stats.shared).toEqual([]);
  });

  it('keeps running for the request that stays when its twin is abandoned', async () => {
    const heard: string[] = [];
    const listening = mockBus.subscribe(DuckdbWasmActivityEvent, (event) => heard.push(event.payload.state));
    const { held, ran, openAll } = holdingRunner({ hold: true });
    const leaving = subscribe(panel('SQR1'));
    const staying = subscribe(panel('SQR2'));
    await until(() => stats.shared.length === 1 && held.length === 1);
    leaving.subscription.unsubscribe();
    expect(held[0].signal?.aborted).toBe(false);
    openAll();
    await until(() => staying.seen.done);
    listening.unsubscribe();

    expect(staying.seen.error).toBeUndefined();
    expect(staying.seen.response?.errors).toBeUndefined();
    expect(valuesOf(staying.seen.response)).toEqual([[[1]]]);
    expect(ran).toHaveLength(1);
    expect(heard).toEqual(['busy', 'settled']);
  });

  it('aborts the execution once every request has been abandoned', async () => {
    const { held, openAll } = holdingRunner({ hold: true });
    const first = subscribe(panel('SQR1'));
    const second = subscribe(panel('SQR2'));
    await until(() => stats.shared.length === 1 && held.length === 1);
    first.subscription.unsubscribe();
    expect(held[0].signal?.aborted).toBe(false);
    second.subscription.unsubscribe();
    expect(held[0].signal?.aborted).toBe(true);
    // The page stays busy until the aborted work has wound down, as it would unshared.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stats.activity.at(-1)?.state).toBe('busy');
    openAll();
    await until(settled);
    expect(stats.activity.map((a) => a.state)).toEqual(['busy', 'settled']);
    expect(first.seen.response).toBeUndefined();
    expect(second.seen.response).toBeUndefined();
  });

  it('runs none of the remaining targets once every request has been abandoned', async () => {
    const { held, ran, openAll } = holdingRunner({ hold: true });
    const twoTargets = makeRequest<DuckQuery>(
      [
        { refId: 'A', rawSql: 'SELECT 1 AS one' },
        { refId: 'B', rawSql: 'SELECT 2 AS two' },
      ],
      { requestId: 'SQR1', panelId: 3, dashboardUID: 'dash' }
    );
    const abandoned = subscribe(twoTargets);
    await until(() => held.length === 1);
    abandoned.subscription.unsubscribe();
    expect(held[0].signal?.aborted).toBe(true);
    openAll();
    await until(settled);
    expect(ran).toEqual(['SELECT 1 AS one']);
    // Only what ran is recorded: the target in flight when the request was abandoned.
    expect(stats.queries.map((q) => q.refId)).toEqual(['A']);
  });

  it('runs an identical request again once the first has answered', async () => {
    const { ran } = holdingRunner({ hold: false });
    await lastValueFrom(ds.query(panel('SQR1')));
    const again = await lastValueFrom(ds.query(panel('SQR2')));
    expect(ran).toHaveLength(2);
    expect(valuesOf(again)).toEqual([[[1]]]);
    expect(stats.shared).toEqual([]);
  });

  it('gives a request that arrives after its twin was abandoned an execution of its own', async () => {
    const { held, ran, openAll } = holdingRunner({ hold: true });
    const abandoned = subscribe(panel('SQR1'));
    await until(() => held.length === 1);
    abandoned.subscription.unsubscribe();
    expect(held[0].signal?.aborted).toBe(true);

    const late = subscribe(panel('SQR2'));
    await until(() => held.length === 2);
    expect(held).toHaveLength(2);
    expect(held[1].signal?.aborted).toBe(false);

    // The abandoned execution settles while the late one still runs: a third
    // request must still find the late one and join it.
    held[0].release();
    await until(() => stats.queries.length === 1);
    const third = subscribe(panel('SQR3'));
    await until(() => stats.shared.length === 1);
    openAll();
    await until(() => late.seen.done && third.seen.done);

    expect(abandoned.seen.response).toBeUndefined();
    for (const { seen } of [late, third]) {
      expect(seen.error).toBeUndefined();
      expect(seen.response?.errors).toBeUndefined();
      expect(valuesOf(seen.response)).toEqual([[[1]]]);
    }
    expect(ran).toHaveLength(2);
    expect(stats.shared).toHaveLength(1);
  });

  it('says busy and settled once for the pair', async () => {
    const heard: string[] = [];
    const listening = mockBus.subscribe(DuckdbWasmActivityEvent, (event) => heard.push(event.payload.state));
    const { held, openAll } = holdingRunner({ hold: true });
    const first = lastValueFrom(ds.query(panel('SQR1')));
    const second = lastValueFrom(ds.query(panel('SQR2')));
    await until(() => stats.shared.length === 1 && held.length === 1);
    expect(stats.shared).toHaveLength(1);
    expect(heard).toEqual(['busy']);
    openAll();
    await Promise.all([first, second]);
    listening.unsubscribe();
    expect(heard).toEqual(['busy', 'settled']);
  });
});

describe('$__proxy in a DataSource', () => {
  const withUrl = (jsonData: DuckOptions) =>
    new DataSource({
      ...settings,
      url: '/api/datasources/proxy/uid/duckdbwasm',
      jsonData,
    } as DataSourceInstanceSettings<DuckOptions>);

  async function valueOf(source: DataSource, sql: string): Promise<string> {
    const response = await source.runVariableQuery(
      makeRequest<DuckVariableQuery>([{ refId: 'v', kind: 'values', sql }])
    );
    return response.data[0].fields.find((f: { name: string }) => f.name === 'value').values[0] as string;
  }

  it("points at this instance's data proxy", async () => {
    expect(await valueOf(withUrl({}), "SELECT $__proxy('cuenca/vias.parquet')")).toBe(
      'http://localhost/api/datasources/proxy/uid/duckdbwasm/_plain/cuenca/vias.parquet'
    );
  });

  it('goes through the key route when an API key parameter is set', async () => {
    expect(await valueOf(withUrl({ proxyKeyParam: 'apikey' }), "SELECT $__proxy('a.parquet')")).toBe(
      'http://localhost/api/datasources/proxy/uid/duckdbwasm/_key/a.parquet'
    );
  });

  it('explains a failed read through the proxy on the panel, asking the proxy for its status', async () => {
    const url = 'http://localhost/api/datasources/proxy/uid/duckdbwasm/_plain/a.parquet';
    const fetchMock = jest.fn(async () => ({ status: 404 }) as Response);
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const failing = `SELECT error('No files found that match the pattern "${url}"')`;
      const response = await withUrl({}).runPanelQueries(makeRequest<DuckQuery>([{ refId: 'A', rawSql: failing }]));
      expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'HEAD', credentials: 'same-origin' }));
      expect(response.errors?.[0].message).toContain("Not found on the server behind this datasource's proxy (HTTP 404)");
    } finally {
      global.fetch = original;
    }
  });

  it("does not turn a parser error that merely echoes this instance's proxy URL into a proxy explanation", async () => {
    const fetchMock = jest.fn();
    const original = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      const failing = "SELECT * FORM read_parquet($__proxy('x.parquet'))";
      const response = await withUrl({}).runPanelQueries(makeRequest<DuckQuery>([{ refId: 'A', rawSql: failing }]));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(response.errors?.[0].message).toContain('Parser Error');
      expect(response.errors?.[0].message).not.toContain("this datasource's proxy");
    } finally {
      global.fetch = original;
    }
  });
});
