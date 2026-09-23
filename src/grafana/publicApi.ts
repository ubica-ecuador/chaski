import { tableToIPC, type Table } from 'apache-arrow';

import { DatasetViews, viewOf } from '../engine/datasetViews';
import type { DatasetRegistry } from '../engine/registry';
import { ScratchPool } from '../engine/scratch';
import type { SqlRunner } from '../engine/types';

/*
 * The contract with other plugins (the explorer, the kepler map). They find it
 * at runtime on window.__chaski and never import this code, so these shapes
 * are pinned by publicApi.test.ts. Additive changes keep apiVersion 1; a
 * breaking change publishes window.__chaski.v2 beside this one.
 */

export interface QueryOpts {
  signal?: AbortSignal;
  /** 'explorer' (default): an explorer connection, not counted as activity. 'panel': the panels' path, counted. */
  consumer?: 'explorer' | 'panel';
}

export interface DatasetInfo {
  name: string;
  /** Qualified view name, e.g. `datasets."sample"`. */
  view: string;
  /** The physical table the view points at now. */
  table: string;
  rows: number;
  loadedAt: number;
  /** Set when the latest reload failed and the view still points at the previous version. */
  stale?: string;
}

export type ChangeEvent = { kind: 'dataset'; name: string; view: string } | { kind: 'dashboard'; dashboard: string };

export interface ChaskiEngineApi {
  duckdbVersion: string;
  /** Runs one statement; the result as an Arrow IPC stream. */
  queryIPC(sql: string, opts?: QueryOpts): Promise<Uint8Array>;
  /** Runs statements whose result nobody reads. */
  exec(sql: string, opts?: QueryOpts): Promise<void>;
  /** The active dashboard's datasets. */
  datasets(): DatasetInfo[];
  onChange(listener: (event: ChangeEvent) => void): () => void;
  /** Empties the explore schema. */
  releaseScratch(): Promise<void>;
}

export interface ChaskiGlobal {
  apiVersion: 1;
  /** undefined until a Chaski query on this page has started the engine. */
  engine(): Promise<ChaskiEngineApi> | undefined;
}

interface ApiDeps {
  runner: SqlRunner;
  registry: DatasetRegistry;
  version: string;
  /** Counts panel-consumer work toward the activity event. */
  track: <T>(work: () => Promise<T>) => Promise<T>;
}

export function createEngineApi({ runner, registry, version, track }: ApiDeps): ChaskiEngineApi {
  const views = new DatasetViews(runner);
  const scratch = new ScratchPool(runner);
  const listeners = new Set<(event: ChangeEvent) => void>();

  const emit = (event: ChangeEvent) => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // One consumer's failure must not reach another, or the engine.
      }
    }
  };
  const onScreen = () => {
    const dashboard = registry.activeDashboard();
    return dashboard === undefined ? [] : registry.list(dashboard);
  };

  registry.subscribe((event) => {
    if (event.kind === 'adopted') {
      // A slow load that lands after the user moved on must not re-point the views.
      if (event.dashboard !== registry.activeDashboard()) {
        return;
      }
      void views.sync(onScreen()).then(() => emit({ kind: 'dataset', name: event.name, view: viewOf(event.name) }));
      return;
    }
    void views
      .sync(onScreen())
      .then(() => scratch.releaseScratch())
      .catch((error: unknown) => console.warn('Chaski: emptying explore', error))
      .then(() => emit({ kind: 'dashboard', dashboard: event.dashboard }));
  });

  const run = (sql: string, opts?: QueryOpts): Promise<Table> =>
    opts?.consumer === 'panel' ? track(() => runner.query(sql, opts.signal)) : scratch.query(sql, opts?.signal);

  return {
    duckdbVersion: version,
    async queryIPC(sql, opts) {
      // Encoded by this bundle's own apache-arrow: another bundle's copy cannot read our Table objects.
      return tableToIPC(await run(sql, opts), 'stream');
    },
    async exec(sql, opts) {
      await run(sql, opts);
    },
    datasets: () =>
      onScreen().map((state) => ({
        name: state.name,
        view: viewOf(state.name),
        table: state.table,
        rows: state.rows,
        loadedAt: state.loadedAt,
        ...(state.stale ? { stale: state.stale.error } : {}),
      })),
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    releaseScratch: () => scratch.releaseScratch(),
  };
}

let published: Promise<ChaskiEngineApi> | undefined;

/** Called by engine.ts: the API once the engine starts, undefined when a start fails. */
export function publishEngineApi(api: Promise<ChaskiEngineApi> | undefined): void {
  published = api;
}

/** Puts the v1 entry point on `target` (the window). Other plugins look for it there at runtime. */
export function installChaskiGlobal(target: object = window): void {
  const entry: ChaskiGlobal = { apiVersion: 1, engine: () => published };
  (target as { __chaski?: ChaskiGlobal }).__chaski = entry;
}
