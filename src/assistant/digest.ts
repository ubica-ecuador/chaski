import type { DatasetInfo } from '../grafana/publicApi';

export interface DigestColumn {
  name: string;
  type: string;
}

export interface DigestTimeRange {
  from: string;
  to: string;
  /** As the URL says it, e.g. `now-6h`: `from`/`to` are only its resolution at the last rebuild. */
  raw?: { from: string; to: string };
}

export interface DigestDataset {
  name: string;
  /** How panel SQL reads it: `$vehicles`. */
  panelSql: string;
  /** How the engine API and the explorer read it: `datasets."vehicles"`. */
  view: string;
  rows: number;
  loadedAt: string;
  /** The latest reload's error; the previous data is still served. */
  stale?: string;
  /** DuckDB column types; absent when DESCRIBE failed. */
  columns?: DigestColumn[];
}

export interface AssistantDigest {
  dashboard: string;
  datasets: DigestDataset[];
  timeRange?: DigestTimeRange;
}

export interface DigestInput {
  dashboard: string;
  datasets: DatasetInfo[];
  /** Columns per physical table, so an unchanged version is described once. */
  columns: ReadonlyMap<string, DigestColumn[]>;
  timeRange?: DigestTimeRange;
}

/** What the Grafana Assistant is told about the datasets on screen: enough to write panel SQL over them. */
export function buildAssistantDigest(input: DigestInput): AssistantDigest {
  return {
    dashboard: input.dashboard,
    datasets: input.datasets.map((d) => {
      const columns = input.columns.get(d.table);
      return {
        name: d.name,
        panelSql: `$${d.name}`,
        view: d.view,
        rows: d.rows,
        loadedAt: new Date(d.loadedAt).toISOString(),
        ...(d.stale ? { stale: d.stale } : {}),
        ...(columns ? { columns } : {}),
      };
    }),
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
  };
}
