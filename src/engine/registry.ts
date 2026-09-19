import { quoteIdent, sanitizeName, shortHash, stripTrailingSemicolons } from './sql';
import type { DatasetLoader, DatasetState, SqlRunner } from './types';

/** Versions of a dataset kept in memory: the current one, and the one before for queries still in flight. */
const KEEP_VERSIONS = 2;

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
  private active?: string;
  /** Monotonic across all dashboards and datasets, so table names never collide across a reactivation. */
  private nextVersion = 0;

  constructor(
    private readonly runner: SqlRunner,
    private readonly now: () => number = Date.now
  ) {}

  /** Makes `dashboard` the one in memory, dropping every table of any other. */
  async activate(dashboard: string): Promise<void> {
    if (this.active === dashboard) {
      return;
    }
    this.active = dashboard;
    for (const [key, entry] of [...this.entries]) {
      if (entry.dashboard === dashboard) {
        continue;
      }
      this.entries.delete(key);
      for (const table of entry.kept) {
        await this.drop(table);
      }
    }
  }

  load(dashboard: string, name: string, loader: DatasetLoader, signature: string): Promise<DatasetState> {
    const key = keyOf(dashboard, name);
    const entry = this.entry(key, dashboard);
    if (entry.inflight && entry.inflight.signature === signature) {
      return entry.inflight.promise;
    }
    const version = ++this.nextVersion;
    const table = `d${shortHash(dashboard)}_${sanitizeName(name)}_v${version}`;
    const promise: Promise<DatasetState> = this.materialize(table, loader)
      .then((rows) => this.adopt(key, entry, { dashboard, name, table, version, loadedAt: this.now(), rows }))
      .catch((error: unknown) => this.fail(key, entry, version, table, error))
      .finally(() => {
        if (entry.inflight?.promise === promise) {
          entry.inflight = undefined;
        }
      });
    entry.inflight = { signature, promise };
    return promise;
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
}
