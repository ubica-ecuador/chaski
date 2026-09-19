import { quoteIdent, quoteLiteral } from './sql';
import type { AdHocFilter } from './types';

/**
 * The WHERE clause for Grafana's ad hoc filters, over the columns a result
 * actually has. A filter on a column the result lacks is skipped rather than
 * failing the panel: ad hoc filters apply to every panel on the dashboard, and
 * most panels won't carry every column.
 */
export function adHocWhere(filters: AdHocFilter[], columns: string[]): string | undefined {
  const present = new Set(columns);
  const clauses = filters
    .filter((filter) => present.has(filter.key))
    .map(clause)
    .filter((c): c is string => c !== undefined);
  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

function clause(filter: AdHocFilter): string | undefined {
  const column = quoteIdent(filter.key);
  const value = quoteLiteral(filter.value);
  const list = (filter.values && filter.values.length > 0 ? filter.values : [filter.value]).map(quoteLiteral).join(', ');
  switch (filter.operator) {
    case '=':
      return `${column} = ${value}`;
    case '!=':
      return `${column} IS DISTINCT FROM ${value}`;
    case '<':
    case '>':
    case '<=':
    case '>=':
      return `${column} ${filter.operator} ${value}`;
    case '=~':
      return `regexp_matches(CAST(${column} AS VARCHAR), ${value})`;
    case '!~':
      return `NOT regexp_matches(CAST(${column} AS VARCHAR), ${value})`;
    case '=|':
      return `${column} IN (${list})`;
    case '!=|':
      return `${column} NOT IN (${list})`;
    default:
      return undefined;
  }
}
