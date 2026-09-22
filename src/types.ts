import type { DataSourceJsonData } from '@grafana/data';
import type { DataQuery, DataSourceRef } from '@grafana/schema';

/** A panel query: SQL run in the browser's DuckDB. */
export interface DuckQuery extends DataQuery {
  rawSql: string;
}

/** A dataset whose rows come from another Grafana datasource, through that datasource's own query path. */
export interface DatasourceSource {
  type: 'datasource';
  datasource: DataSourceRef;
  /** The other datasource's query model, as its own editor writes it. */
  query: DataQuery;
}

/** A dataset produced by SQL in the browser: read a URL, or derive from another dataset. */
export interface SqlSource {
  type: 'sql';
  sql: string;
}

export type DatasetSource = DatasourceSource | SqlSource;

/** A variable that loads a dataset. Its value is the table panels read. */
export interface DatasetVariableQuery extends DataQuery {
  kind: 'dataset';
  name: string;
  source: DatasetSource;
}

/** An ordinary dropdown from local SQL: first column is the value, second (optional) the text. */
export interface ValuesVariableQuery extends DataQuery {
  kind: 'values';
  sql: string;
}

export type DuckVariableQuery = DatasetVariableQuery | ValuesVariableQuery;

export interface DuckOptions extends DataSourceJsonData {
  memoryLimitMB?: number;
  /** Query-string parameter the `_key` route adds with the secret API key. Empty: no key in the URL. */
  proxyKeyParam?: string;
  /** Grafana's standard custom headers, read by its data proxy from 1 up to the first gap. */
  [header: `httpHeaderName${number}`]: string | undefined;
}

/** Secrets, encrypted by Grafana and only ever read by its data proxy. */
export interface DuckSecureOptions {
  basicAuthPassword?: string;
  proxyKeyValue?: string;
  [header: `httpHeaderValue${number}`]: string | undefined;
}

export const DEFAULT_MEMORY_LIMIT_MB = 1024;

export const DEFAULT_QUERY: Partial<DuckQuery> = { rawSql: '' };

export const DEFAULT_VARIABLE_QUERY: DatasetVariableQuery = {
  refId: 'dataset',
  kind: 'dataset',
  name: '',
  source: { type: 'sql', sql: '' },
};
