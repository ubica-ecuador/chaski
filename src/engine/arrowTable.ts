import { Table, type RecordBatch, type Schema } from 'apache-arrow';

/**
 * Builds a Table from a streamed query's batches, the way `tableFromIPC` and
 * `new Table(batches)` alone do not: a zero-row result has no batches, and
 * both of those drop the schema in that case, which would turn an empty
 * panel result into a frame with no fields.
 */
export function tableFromBatches(schema: Schema, batches: RecordBatch[]): Table {
  return batches.length > 0 ? new Table(batches) : new Table(schema, []);
}
