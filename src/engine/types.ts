import type { Table } from 'apache-arrow';

import type { LoadWindow } from './rangeReuse';

/**
 * A long-lived connection that keeps its own settings (USE, search_path), for
 * callers outside the panels. One statement at a time: whoever holds it waits
 * for each query before sending the next.
 */
export interface SqlSession {
  /** Runs one statement (or several; the last one's rows come back). Aborting cancels it. */
  query(sql: string, signal?: AbortSignal): Promise<Table>;
  close(): Promise<void>;
}

/** What the engine needs from a DuckDB: the browser build in production, the Node build in tests. */
export interface SqlRunner {
  /** Runs one statement and returns its rows as Arrow. Aborting cancels the statement. */
  query(sql: string, signal?: AbortSignal): Promise<Table>;
  /** Runs a statement whose result nobody reads (CREATE, DROP, SET). */
  exec(sql: string): Promise<void>;
  /** Creates table `name` from an Arrow table. */
  insertArrow(name: string, table: Table): Promise<void>;
  /**
   * Opens a connection and runs `setup` on it once. Optional so that test
   * doubles which never serve the explorer need not implement it.
   */
  openSession?(setup: string[]): Promise<SqlSession>;
}

export interface ColumnInfo {
  name: string;
  /** DuckDB's type name as DESCRIBE prints it: 'VARCHAR', 'DECIMAL(10,2)', 'GEOMETRY'… */
  type: string;
}

/** One of Grafana's ad hoc filters. `values` carries the multi-value operators' list. */
export interface AdHocFilter {
  key: string;
  operator: string;
  value: string;
  values?: string[];
}

/** How a dataset gets its rows. */
export type DatasetLoader = { kind: 'sql'; sql: string } | { kind: 'arrow'; fetch: () => Promise<Table> };

export interface DatasetState {
  dashboard: string;
  name: string;
  /** The table panels should read now. */
  table: string;
  version: number;
  /** When `table` was loaded, epoch ms. */
  loadedAt: number;
  rows: number;
  /** Set when the latest reload failed and `table` is still the previous version. */
  stale?: { error: string; failedAt: number };
  /** The source's signature this table was loaded with (see decideDatasetLoad). */
  signature?: string;
  /** The time window this table was loaded for, when the request carried one. */
  window?: LoadWindow;
  /** The dashboard visit it was loaded in (DatasetRegistry.visitOf). */
  visit?: number;
}
