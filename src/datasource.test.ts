/** @jest-environment jsdom */
import type { DataSourceInstanceSettings } from '@grafana/data';
import { lastValueFrom } from 'rxjs';

import { DataSource } from './datasource';
import { DatasetRegistry } from './engine/registry';
import { createNodeRunner } from './engine/testing/nodeRunner';
import type { SqlRunner } from './engine/types';
import { setEngineForTests } from './grafana/engine';
import { fakeTemplateSrv, makeRequest } from './grafana/testing/fakes';
import type { DuckOptions, DuckQuery, DuckVariableQuery } from './types';

const mockTemplateSrv = { current: fakeTemplateSrv({}) };

jest.mock('@grafana/runtime', () => ({
  getTemplateSrv: () => mockTemplateSrv.current,
  getDataSourceSrv: () => ({ get: async () => ({ name: 'unused', query: () => ({ data: [] }) }) }),
  locationService: { getLocation: () => ({ pathname: '/d/dash1/test' }) },
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
