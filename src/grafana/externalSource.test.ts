import { createDataFrame, FieldType } from '@grafana/data';
import type { DataQuery } from '@grafana/schema';
import { of } from 'rxjs';

import { loadFromDatasource } from './externalSource';
import { makeRequest } from './testing/fakes';

const mockQuery = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ get: async () => ({ name: 'Server DuckDB', query: mockQuery }) }),
}));

const source = {
  type: 'datasource' as const,
  datasource: { uid: 'duckdb', type: 'motherduck-duckdb-datasource' },
  query: { refId: 'x', rawSql: 'SELECT 1' } as DataQuery,
};

describe('loadFromDatasource', () => {
  beforeEach(() => mockQuery.mockReset());

  it("sends the source query with the dashboard's range and returns its rows as Arrow", async () => {
    mockQuery.mockReturnValue(
      of({ data: [createDataFrame({ fields: [{ name: 'n', type: FieldType.number, values: [1, 2] }] })] })
    );
    const request = makeRequest([{ refId: 'v' }]);
    const table = await loadFromDatasource(source, request);
    expect(table.numRows).toBe(2);
    const sent = mockQuery.mock.calls[0][0];
    expect(sent.targets).toEqual([
      { refId: 'dataset', rawSql: 'SELECT 1', datasource: { uid: 'duckdb', type: 'motherduck-duckdb-datasource' } },
    ]);
    expect(sent.range).toBe(request.range);
    expect(sent.filters).toBeUndefined();
  });

  it('accepts a datasource that answers with a promise', async () => {
    mockQuery.mockResolvedValue({ data: [] });
    expect((await loadFromDatasource(source, makeRequest([{ refId: 'v' }]))).numRows).toBe(0);
  });

  it("throws the source's error", async () => {
    mockQuery.mockReturnValue(of({ data: [], errors: [{ message: 'boom' }] }));
    await expect(loadFromDatasource(source, makeRequest([{ refId: 'v' }]))).rejects.toThrow('boom');
  });
});
