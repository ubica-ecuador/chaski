/** A raw time bound as the dashboard asked for it: a relative expression ('now-7d'), or epoch ms. */
export type RawTime = string | number;

/** A dataset's time window: the evaluated bounds in epoch ms, and the raw bounds behind them. */
export interface LoadWindow {
  from: number;
  to: number;
  rawFrom: RawTime;
  rawTo: RawTime;
}

/** What the registry remembers about the table a dataset variable points at. */
export interface LoadedWindow {
  window: LoadWindow;
  /** The source's signature, computed with the range pinned to `window`. */
  signature: string;
  /** The dashboard visit the table was loaded in (DatasetRegistry.visitOf). */
  visit: number;
  /** True when the last reload failed and the table is an older version. */
  stale: boolean;
}

export interface NextLoad {
  window: LoadWindow;
  /** The source's signature now, with the range pinned to the *loaded* window; undefined if it can't be computed. */
  signatureAtLoadedWindow: string | undefined;
  visit: number;
  /** Whether a load of this dataset is already in flight. */
  loading: boolean;
}

export type LoadDecision = 'reuse' | 'load';

const sameRaw = (a: LoadWindow, b: LoadWindow) => a.rawFrom === b.rawFrom && a.rawTo === b.rawTo;

/**
 * Whether a dataset variable's request can be answered with the table already
 * loaded, or needs a load.
 *
 * Grafana re-runs a `refresh: 2` dataset on every time-range change and on every
 * refresh. A refresh keeps the raw range and always loads: whoever refreshes
 * wants new data. A range change reuses the table when the new window fits in
 * the loaded one and nothing else about the source moved. Two windows that both
 * end at 'now' count as sharing their end, so switching from "Last 7 days" to
 * "Last 24 hours" stays local; the data then runs to the last load rather than
 * to this second. They must still overlap: a window that starts after the
 * loaded one ended ("Last 1 hour", picked hours later) has none of its rows in
 * the table, so it loads. Anything uncertain loads: the worst case is a missed
 * reuse, never wrong data.
 */
export function decideDatasetLoad(loaded: LoadedWindow | undefined, next: NextLoad): LoadDecision {
  if (!loaded || loaded.stale || next.loading || loaded.visit !== next.visit) {
    return 'load';
  }
  if (sameRaw(loaded.window, next.window)) {
    return 'load';
  }
  if (next.signatureAtLoadedWindow === undefined || next.signatureAtLoadedWindow !== loaded.signature) {
    return 'load';
  }
  const overlaps = next.window.from < loaded.window.to;
  const nowRule = loaded.window.rawTo === 'now' && next.window.rawTo === 'now' && overlaps;
  const contained = next.window.from >= loaded.window.from && (next.window.to <= loaded.window.to || nowRule);
  return contained ? 'reuse' : 'load';
}
