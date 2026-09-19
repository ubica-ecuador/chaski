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
  const parts: string[] = [];
  for (const { name, type } of columns) {
    const column = quoteIdent(name);
    const upper = type.toUpperCase();
    if (upper === 'GEOMETRY') {
      parts.push(`ST_AsWKB(${column}) AS ${column}`);
    } else if (TO_DOUBLE.has(upper) || upper.startsWith('DECIMAL')) {
      parts.push(`CAST(${column} AS DOUBLE) AS ${column}`);
    } else if (TO_TEXT.has(upper)) {
      parts.push(`CAST(${column} AS VARCHAR) AS ${column}`);
    }
  }
  return parts.length > 0 ? parts.join(', ') : undefined;
}
