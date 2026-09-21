/**
 * What the engine did, kept in a small ring, and read by the phase 0
 * measurement harness through `window.__duckdbwasm.stats`. Cheap enough to
 * leave on.
 */
export interface LoadStat {
  name: string;
  ms: number;
  rows: number;
  ok: boolean;
  at: number;
}

export interface QueryStat {
  refId: string;
  ms: number;
  rows: number;
  /** False when the panel's query failed: the harness still counts it as answered. */
  ok: boolean;
  at: number;
  /** The panel this query answered for, when Grafana sent one on the request. */
  panelId?: number;
}

export interface KeyStat {
  kind: 'panel' | 'variable';
  source: 'request' | 'location';
  key: string;
}

export interface ReuseStat {
  name: string;
  at: number;
}

export interface ActivityStat {
  state: 'busy' | 'settled';
  pending: number;
  at: number;
}

export interface EngineStats {
  engineStartMs?: number;
  loads: LoadStat[];
  queries: QueryStat[];
  keys: KeyStat[];
  reuses: ReuseStat[];
  activity: ActivityStat[];
}

const LIMIT = 500;

export const stats: EngineStats = { loads: [], queries: [], keys: [], reuses: [], activity: [] };

function push<T>(list: T[], entry: T): void {
  list.push(entry);
  if (list.length > LIMIT) {
    list.shift();
  }
}

export const recordLoad = (entry: LoadStat) => push(stats.loads, entry);
export const recordQuery = (entry: QueryStat) => push(stats.queries, entry);
export const recordKey = (entry: KeyStat) => push(stats.keys, entry);
export const recordReuse = (entry: ReuseStat) => push(stats.reuses, entry);
export const recordActivity = (entry: ActivityStat) => push(stats.activity, entry);
