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
 * Syncs and points run one at a time, in call order, on one queue. A
 * statement that fails is reported and skipped, never thrown: the views are a
 * convenience, and a dataset load must not fail over them.
 */
export class DatasetViews {
  private queue: Promise<void> = Promise.resolve();
  /** Whether the `datasets` schema is known to exist, so a point can skip creating it. */
  private schemaReady = false;

  constructor(
    private readonly runner: SqlRunner,
    private readonly onError: (error: unknown) => void = (error) => console.warn('Chaski: dataset view', error)
  ) {}

  /** Makes the views match `states` exactly: one per state, on its table; no others. */
  sync(states: DatasetState[]): Promise<void> {
    const run = this.queue.then(() => this.apply(states));
    this.queue = run.catch(() => undefined);
    return run.catch(() => undefined);
  }

  /**
   * Creates or replaces the one view of `name`, on `table`: what a load needs,
   * without re-creating the dashboard's other views. Resolves whether the view
   * now reads `table`; never rejects.
   */
  point(name: string, table: string): Promise<boolean> {
    const run = this.queue.then(() => this.pointNow(name, table));
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run.catch(() => false);
  }

  private async apply(states: DatasetState[]): Promise<void> {
    await this.ensureSchema();
    const wanted = new Map(states.map((state) => [state.name, state.table]));
    let existing: string[] = [];
    try {
      const result = await this.runner.query(
        `SELECT view_name FROM duckdb_views() WHERE schema_name = '${DATASETS_SCHEMA}' AND NOT internal`
      );
      existing = result.toArray().map((row) => String(row.view_name));
    } catch (error) {
      this.report(error);
    }
    for (const name of existing) {
      if (!wanted.has(name)) {
        await this.run(`DROP VIEW IF EXISTS ${viewOf(name)}`);
      }
    }
    for (const [name, table] of wanted) {
      await this.createView(name, table);
    }
  }

  private async pointNow(name: string, table: string): Promise<boolean> {
    if (!this.schemaReady) {
      await this.ensureSchema();
    }
    return this.createView(name, table);
  }

  private createView(name: string, table: string): Promise<boolean> {
    return this.run(`CREATE OR REPLACE VIEW ${viewOf(name)} AS SELECT * FROM main.${quoteIdent(table)}`);
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady = await this.run(`CREATE SCHEMA IF NOT EXISTS ${DATASETS_SCHEMA}`);
  }

  /** Runs one statement; a failure is reported and resolves false. */
  private async run(sql: string): Promise<boolean> {
    try {
      await this.runner.exec(sql);
      return true;
    } catch (error) {
      this.report(error);
      return false;
    }
  }

  private report(error: unknown): void {
    try {
      this.onError(error);
    } catch (errorHandlerError) {
      console.warn('Chaski: dataset view error handler threw', errorHandlerError);
    }
  }
}
