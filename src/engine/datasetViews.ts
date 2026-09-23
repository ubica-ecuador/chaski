import { quoteIdent } from './sql';
import type { DatasetState, SqlRunner } from './types';

export const DATASETS_SCHEMA = 'datasets';

/** The view a dataset is read through by name: `datasets."sample"`. */
export const viewOf = (name: string): string => `${DATASETS_SCHEMA}.${quoteIdent(name)}`;

/**
 * One view per dataset of the dashboard on screen, in the `datasets` schema,
 * pointing at the version the panels read now. Callers outside the panels (the
 * explorer, the kepler map) then name a dataset without knowing its versioned
 * table.
 *
 * Syncs run one at a time, in call order. A statement that fails is reported
 * and skipped, never thrown: the views are a convenience, and a dataset load
 * must not fail over them.
 */
export class DatasetViews {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: SqlRunner,
    private readonly onError: (error: unknown) => void = (error) => console.warn('Chaski: dataset view', error)
  ) {}

  /** Makes the views match `states` exactly: one per state, on its table; no others. */
  sync(states: DatasetState[]): Promise<void> {
    const run = this.queue.then(() => this.apply(states));
    this.queue = run;
    return run;
  }

  private async apply(states: DatasetState[]): Promise<void> {
    await this.run(`CREATE SCHEMA IF NOT EXISTS ${DATASETS_SCHEMA}`);
    const wanted = new Map(states.map((state) => [state.name, state.table]));
    let existing: string[] = [];
    try {
      const result = await this.runner.query(
        `SELECT view_name FROM duckdb_views() WHERE schema_name = '${DATASETS_SCHEMA}' AND NOT internal`
      );
      existing = result.toArray().map((row) => String(row.view_name));
    } catch (error) {
      this.onError(error);
    }
    for (const name of existing) {
      if (!wanted.has(name)) {
        await this.run(`DROP VIEW IF EXISTS ${viewOf(name)}`);
      }
    }
    for (const [name, table] of wanted) {
      await this.run(`CREATE OR REPLACE VIEW ${viewOf(name)} AS SELECT * FROM main.${quoteIdent(table)}`);
    }
  }

  private async run(sql: string): Promise<void> {
    try {
      await this.runner.exec(sql);
    } catch (error) {
      this.onError(error);
    }
  }
}
