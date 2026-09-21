/** @jest-environment jsdom */
import { type DataQueryRequest, type DataQueryResponse, type DataSourceInstanceSettings, dateTime, EventBusSrv } from '@grafana/data';
import type { DataQuery } from '@grafana/schema';
import { lastValueFrom } from 'rxjs';

import { DataSource } from './datasource';
import { DatasetRegistry } from './engine/registry';
import { stats } from './engine/stats';
import { createNodeRunner } from './engine/testing/nodeRunner';
import type { SqlRunner } from './engine/types';
import { setEngineForTests } from './grafana/engine';
import { fakeTemplateSrv, makeRequest } from './grafana/testing/fakes';
import { DuckdbWasmActivityEvent } from './grafana/activity';
import type { DuckOptions, DuckQuery, DuckVariableQuery } from './types';

const mockTemplateSrv = { current: fakeTemplateSrv({}) };
const mockSourceQuery = jest.fn((..._args: unknown[]): unknown => ({ data: [] }));
const mockBus = new EventBusSrv();

jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: () => mockTemplateSrv.current,
  getDataSourceSrv: () => ({ get: async () => ({ name: 'upstream', query: (...args: unknown[]) => mockSourceQuery(...args) }) }),
  locationService: { getLocation: () => ({ pathname: '/d/dash1/test' }) },
  getAppEvents: () => mockBus,
}));
// The real editor pulls in @grafana/ui, which needs a DOM.
jest.mock('./components/VariableQueryEditor', () => ({ VariableQueryEditor: () => null }));

const settings = {
  id: 1,
  uid: 'duckdbwasm',
  type: 'ubica-duckdbwasm-datasource',
  name: 'DuckDB WASM',
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
  const HOURS = "SELECT * FROM (SELECT TIMESTAMP '2026-09-18' + to_hours(range) AS t FROM range(24)) WHERE $__timeFilter(t)";

  const absolute = (from: number, to: number): Partial<DataQueryRequest<DuckVariableQuery>> => {
    const f = dateTime(from);
    const t = dateTime(to);
    return { range: { from: f, to: t, raw: { from: f, to: t } } };
  };
  const relative = (from: number, to: number, rawFrom: string): Partial<DataQueryRequest<DuckVariableQuery>> => ({
    range: { from: dateTime(from), to: dateTime(to), raw: { from: rawFrom, to: 'now' } },
  });
  const sqlDataset = (sql: string, extra: Partial<DataQueryRequest<DuckVariableQuery>>) =>
    makeRequest<DuckVariableQuery>([{ refId: 'h', kind: 'dataset', name: 'hours', source: { type: 'sql', sql } }], extra);
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
    const second = tableOf(await ds.runVariableQuery(sqlDataset(HOURS, relative(FROM + 60_000, TO + 60_000, 'now-1d'))));
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
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 300 && !check(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('announces busy and settled around variable and panel queries', async () => {
    const heard: string[] = [];
    const subscription = mockBus.subscribe(DuckdbWasmActivityEvent, (event) => heard.push(event.payload.state));
    await lastValueFrom(
      ds.variableQuery(
        makeRequest<DuckVariableQuery>([{ refId: 'c', kind: 'dataset', name: 'cities', source: { type: 'sql', sql: CITIES } }])
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
