import { type DataQueryRequest, type DataQueryResponse, toDataFrame } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';
import type { DataQuery } from '@grafana/schema';
import type { Table } from 'apache-arrow';
import { isObservable, lastValueFrom } from 'rxjs';

import type { DatasourceSource } from '../types';
import { dataFramesToArrow } from './frameToArrow';

/**
 * Rows for a dataset, from another datasource. The query goes through that
 * datasource's own `query()` (its interpolation, its secrets, its caching,
 * /api/ds/query), with the dashboard's time range and variables. Ad hoc
 * filters are not passed on: they apply to panels, locally.
 */
export async function loadFromDatasource(
  source: DatasourceSource,
  request: DataQueryRequest<DataQuery>
): Promise<Table> {
  const datasource = await getDataSourceSrv().get(source.datasource, request.scopedVars);
  const target: DataQuery = { ...source.query, refId: 'dataset', datasource: source.datasource };
  const result = datasource.query({
    ...request,
    targets: [target],
    requestId: `${request.requestId}-dataset`,
    filters: undefined,
  });
  const response: DataQueryResponse = isObservable(result) ? await lastValueFrom(result) : await result;
  const error = response.errors?.[0] ?? response.error;
  if (error) {
    throw new Error(error.message ?? `The ${datasource.name} datasource returned an error`);
  }
  return dataFramesToArrow((response.data ?? []).map((data: unknown) => toDataFrame(data)));
}
