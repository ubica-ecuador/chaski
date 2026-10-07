import type { DatasetInfo } from '../grafana/publicApi';

export interface DigestColumn {
  name: string;
  type: string;
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
  timeRange?: { from: string; to: string };
}

export interface DigestInput {
  dashboard: string;
  datasets: DatasetInfo[];
  /** Columns per physical table, so an unchanged version is described once. */
  columns: ReadonlyMap<string, DigestColumn[]>;
  timeRange?: { from: string; to: string };
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
