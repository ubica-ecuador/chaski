import { quoteIdent } from './sql';
import type { ColumnInfo } from './types';

const TO_DOUBLE = new Set(['HUGEINT', 'UHUGEINT']);
const TO_TEXT = new Set(['INTERVAL', 'UUID', 'BIT', 'TIME', 'TIME WITH TIME ZONE', 'TIMETZ']);

/**
 * A `* REPLACE (…)` list turning the DuckDB types a Grafana DataFrame can't
 * carry into ones it can, or undefined when every column already fits.
 *
 * GEOMETRY becomes WKB, which the conversion to a DataFrame prints as hex: the
 * form the kepler panel's WKB decoder reads, and exactly what the server DuckDB
 * datasource fails to deliver (its geometry arrives UTF-8-mangled).
 */
export function normalizingReplace(columns: ColumnInfo[]): string | undefined {
  const parts = columns.map(normalizing).filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Whether normalizingReplace casts this column. */
export function isNormalized(column: ColumnInfo): boolean {
  return normalizing(column) !== undefined;
}

function normalizing({ name, type }: ColumnInfo): string | undefined {
  const column = quoteIdent(name);
  const upper = type.toUpperCase();
  if (upper === 'GEOMETRY') {
    return `ST_AsWKB(${column}) AS ${column}`;
  } else if (TO_DOUBLE.has(upper) || upper.startsWith('DECIMAL')) {
    return `CAST(${column} AS DOUBLE) AS ${column}`;
  } else if (TO_TEXT.has(upper)) {
    return `CAST(${column} AS VARCHAR) AS ${column}`;
  }
  return undefined;
}
