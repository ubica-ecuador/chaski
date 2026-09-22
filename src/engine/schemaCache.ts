import type { ColumnInfo } from './types';

/** What DESCRIBE said about a panel query, and what the query returned with it. */
export interface CachedSchema {
  columns: ColumnInfo[];
  /** The result's field names and Arrow types, in order. */
  shape: string;
  /** Columns whose DuckDB type the result can't show, so a reuse asserts it. */
  asserted: ColumnInfo[];
}

/** A statement whose columns follow its values: it is described on every run. */
export const UNSTABLE = 'unstable';

export type SchemaEntry = CachedSchema | typeof UNSTABLE;

/** Remembered schemas, by statement shape (maskStringLiterals), least recently used forgotten first. */
export class SchemaCache {
  private readonly entries = new Map<string, SchemaEntry>();

  constructor(private readonly limit = 256) {}

  get(key: string): SchemaEntry | undefined {
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: SchemaEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
