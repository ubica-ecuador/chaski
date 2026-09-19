import { quoteIdent, sanitizeName, shortHash, stripTrailingSemicolons } from './sql';
import type { DatasetLoader, DatasetState, SqlRunner } from './types';

/** Versions of a dataset kept in memory: the current one, and the one before for queries still in flight. */
const KEEP_VERSIONS = 2;

interface Entry {
  dashboard: string;
  state?: DatasetState;
  /** Tables of this dataset still in DuckDB, oldest first. */
  kept: string[];
  lastVersion: number;
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
    const version = ++entry.lastVersion;
    const table = `d${shortHash(dashboard)}_${sanitizeName(name)}_v${version}`;
    const promise: Promise<DatasetState> = this.materialize(table, loader)
      .then((rows) => this.adopt(key, { dashboard, name, table, version, loadedAt: this.now(), rows }))
      .catch((error: unknown) => this.fail(key, table, error))
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
      entry = { dashboard, kept: [], lastVersion: 0 };
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

  private async adopt(key: string, fresh: DatasetState): Promise<DatasetState> {
    const entry = this.entries.get(key);
    if (!entry) {
      // The dashboard was switched away while this was loading.
      await this.drop(fresh.table);
      return fresh;
    }
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

  private async fail(key: string, table: string, error: unknown): Promise<DatasetState> {
    await this.drop(table);
    const entry = this.entries.get(key);
    if (!entry?.state) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    entry.state = { ...entry.state, stale: { error: message, failedAt: this.now() } };
    return entry.state;
  }

  private async drop(table: string): Promise<void> {
    await this.runner.exec(`DROP TABLE IF EXISTS ${quoteIdent(table)}`).catch(() => undefined);
  }
}
