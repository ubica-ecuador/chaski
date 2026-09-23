import type { LoadedWindow, LoadWindow } from './rangeReuse';
import { quoteIdent, sanitizeName, shortHash, stripTrailingSemicolons } from './sql';
import type { DatasetLoader, DatasetState, RegistryEvent, SqlRunner } from './types';

/** Versions of a dataset kept in memory: the current one, and the one before for queries still in flight. */
const KEEP_VERSIONS = 2;

/**
 * Dashboards kept in memory at once, most recently activated first. Grafana
 * 12's scene cache can restore a dashboard on browser Back without re-running
 * its dataset variables, so a panel can come back pointing at a table from a
 * dashboard that was active a couple of navigations ago. Keeping a small LRU
 * of dashboards, rather than only the current one, means that ordinary
 * back-and-forth navigation still finds its tables.
 */
const KEEP_DASHBOARDS = 3;

interface Entry {
  dashboard: string;
  state?: DatasetState;
  /** Tables of this dataset still in DuckDB, oldest first. */
  kept: string[];
  inflight?: { signature: string; promise: Promise<DatasetState> };
}

const keyOf = (dashboard: string, name: string) => JSON.stringify([dashboard, name]);

/**
 * The datasets of the dashboard on screen, one DuckDB table per loaded version.
 *
 * Every load writes a new table, so a reload never pulls rows from under a
 * query reading the previous version, and the dataset variable's value (the
 * table name) changes on each load. That change is what makes Grafana re-run
 * the panels depending on it.
 */
export class DatasetRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Dashboard keys, most recently activated first (lru[0] is the active one); at most KEEP_DASHBOARDS long. */
  private readonly lru: string[] = [];
  /** Monotonic across all dashboards and datasets, so table names never collide across a reactivation. */
  private nextVersion = 0;
  /** How many times each dashboard has become the active one: a new visit starts every time. */
  private readonly visits = new Map<string, number>();
  /** Set when the user left lru[0] for a page this datasource doesn't serve (see leave). */
  private frontLeft = false;
  private readonly listeners = new Set<(event: RegistryEvent) => void>();

  constructor(
    private readonly runner: SqlRunner,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Makes `dashboard` the most recently used one, starting a new visit unless
   * it already was the one on screen. Once more than KEEP_DASHBOARDS have been
   * activated, the least recently used dashboard's tables are dropped (see
   * KEEP_DASHBOARDS for why more than one is kept).
   */
  async activate(dashboard: string): Promise<void> {
    const index = this.lru.indexOf(dashboard);
    if (index === 0 && !this.frontLeft) {
      return;
    }
    this.frontLeft = false;
    this.visits.set(dashboard, this.visitOf(dashboard) + 1);
    if (index === 0) {
      return;
    }
    if (index !== -1) {
      this.lru.splice(index, 1);
    }
    this.lru.unshift(dashboard);
    while (this.lru.length > KEEP_DASHBOARDS) {
      const evicted = this.lru.pop()!;
      for (const [key, entry] of [...this.entries]) {
        if (entry.dashboard !== evicted) {
          continue;
        }
        this.entries.delete(key);
        for (const table of entry.kept) {
          await this.drop(table);
        }
      }
    }
    this.emit({ kind: 'activated', dashboard });
  }

  /**
   * The user left the dashboard on screen. Only requests from this datasource
   * activate dashboards, so a trip to a page without it (Home, or a dashboard
   * on another datasource) and back would otherwise look like one long visit.
   * The next activate() of the same dashboard starts a new visit. Its tables
   * stay: a dashboard restored by browser Back without re-running its
   * variables still finds them; only reusing them for a new range is ruled out.
   */
  leave(): void {
    this.frontLeft = true;
  }

  /** Calls `listener` on every event; the returned function stops it. */
  subscribe(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The dashboard on screen: the one activated most recently, if any. */
  activeDashboard(): string | undefined {
    return this.lru[0];
  }

  load(
    dashboard: string,
    name: string,
    loader: DatasetLoader,
    signature: string,
    window?: LoadWindow
  ): Promise<DatasetState> {
    const key = keyOf(dashboard, name);
    const entry = this.entry(key, dashboard);
    if (entry.inflight && entry.inflight.signature === signature) {
      return entry.inflight.promise;
    }
    const version = ++this.nextVersion;
    const visit = this.visitOf(dashboard);
    const table = `d${shortHash(dashboard)}_${sanitizeName(name)}_v${version}`;
    const promise: Promise<DatasetState> = this.materialize(table, loader)
      .then((rows) =>
        this.adopt(key, entry, {
          dashboard,
          name,
          table,
          version,
          loadedAt: this.now(),
          rows,
          signature,
          window,
          visit,
        })
      )
      .catch((error: unknown) => this.fail(key, entry, version, table, error))
      .finally(() => {
        if (entry.inflight?.promise === promise) {
          entry.inflight = undefined;
        }
      });
    entry.inflight = { signature, promise };
    return promise;
  }

  /** The current visit to `dashboard`, bumped each time it becomes the active dashboard; 0 if never. */
  visitOf(dashboard: string): number {
    return this.visits.get(dashboard) ?? 0;
  }

  /** Whether a load of this dataset is in flight. */
  isLoading(dashboard: string, name: string): boolean {
    return this.entries.get(keyOf(dashboard, name))?.inflight !== undefined;
  }

  /** What decideDatasetLoad needs about the table a dataset points at, if it was loaded with a window. */
  loadedWindow(dashboard: string, name: string): LoadedWindow | undefined {
    const state = this.get(dashboard, name);
    if (!state?.window || state.signature === undefined || state.visit === undefined) {
      return undefined;
    }
    return { window: state.window, signature: state.signature, visit: state.visit, stale: state.stale !== undefined };
  }

  get(dashboard: string, name: string): DatasetState | undefined {
    return this.entries.get(keyOf(dashboard, name))?.state;
  }

  byTable(table: string): DatasetState | undefined {
    for (const entry of this.entries.values()) {
      if (entry.kept.includes(table)) {
        return entry.state;
      }
    }
    return undefined;
  }

  list(dashboard: string): DatasetState[] {
    const states: DatasetState[] = [];
    for (const entry of this.entries.values()) {
      if (entry.dashboard === dashboard && entry.state) {
        states.push(entry.state);
      }
    }
    return states;
  }

  private entry(key: string, dashboard: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { dashboard, kept: [] };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private async materialize(table: string, loader: DatasetLoader): Promise<number> {
    if (loader.kind === 'sql') {
      await this.runner.exec(`CREATE TABLE ${quoteIdent(table)} AS ${stripTrailingSemicolons(loader.sql)}`);
    } else {
      await this.runner.insertArrow(table, await loader.fetch());
    }
    const count = await this.runner.query(`SELECT count(*)::DOUBLE AS n FROM ${quoteIdent(table)}`);
    return Number(count.get(0)?.n ?? 0);
  }

  private async adopt(key: string, capturedEntry: Entry, fresh: DatasetState): Promise<DatasetState> {
    const live = this.entries.get(key);
    if (live !== capturedEntry) {
      // The dashboard was switched away (and possibly back) while this was loading;
      // capturedEntry is no longer the live one, so this load is an orphan.
      await this.drop(fresh.table);
      return live?.state ?? fresh;
    }
    const entry = capturedEntry;
    if (entry.state && entry.state.version > fresh.version) {
      // A newer load finished first; this one is already out of date.
      await this.drop(fresh.table);
      return entry.state;
    }
    entry.state = fresh;
    entry.kept.push(fresh.table);
    while (entry.kept.length > KEEP_VERSIONS) {
      await this.drop(entry.kept.shift()!);
    }
    this.emit({ kind: 'adopted', dashboard: fresh.dashboard, name: fresh.name });
    return fresh;
  }

  private async fail(key: string, capturedEntry: Entry, version: number, table: string, error: unknown): Promise<DatasetState> {
    await this.drop(table);
    if (this.entries.get(key) !== capturedEntry) {
      // Orphan: the dashboard was switched away (and possibly back) while this was loading.
      throw error;
    }
    const entry = capturedEntry;
    if (!entry.state) {
      throw error;
    }
    if (version <= entry.state.version) {
      // An older load failed after a newer one already succeeded; leave the good state alone.
      return entry.state;
    }
    const message = error instanceof Error ? error.message : String(error);
    entry.state = { ...entry.state, stale: { error: message, failedAt: this.now() } };
    return entry.state;
  }

  private async drop(table: string): Promise<void> {
    await this.runner.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`).catch(() => undefined);
  }

  private emit(event: RegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A listener's failure must never reach a load.
      }
    }
  }
}
