import type { ScopedVars, TimeRange } from '@grafana/data';
import type { TemplateSrv } from '@grafana/runtime';

import type { CrossfilterSource } from '../engine/crossfilter';
import { expandMacros } from '../engine/macros';
import { quoteIdent, quoteLiteral } from '../engine/sql';

/** Grafana's `sqlstring` format, which the server DuckDB datasource applies to every variable. */
export function sqlStringFormat(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((v) => quoteLiteral(String(v))).join(',');
  }
  return quoteLiteral(String(value));
}

export interface InterpolateOptions {
  templateSrv: TemplateSrv;
  scopedVars?: ScopedVars;
  range: TimeRange;
  /** Whether a variable's value names a loaded dataset table. */
  isDatasetTable: (name: string) => boolean;
  /** This instance's data proxy base for `$__proxy` (see proxyBaseUrl). */
  proxyBase?: string;
  /** The declared datasets and the variables' raw values, for `$__crossfilter` and `$__filters`. */
  crossfilter?: CrossfilterSource;
}

/**
 * A variable's value as Grafana holds it, before any quoting: a list for a
 * multi-value variable, undefined when the dashboard has no such variable.
 */
export function rawValue(
  templateSrv: TemplateSrv,
  name: string,
  scopedVars?: ScopedVars
): string | string[] | undefined {
  let found: string | string[] | undefined;
  templateSrv.replace(`\${${name}}`, scopedVars, (value: unknown) => {
    found = Array.isArray(value) ? value.map(String) : value === null || value === undefined ? '' : String(value);
    return '';
  });
  return found;
}

/**
 * Variables first, then macros: the same order as the server datasource, where
 * the frontend interpolates and the backend expands. A value naming a loaded
 * dataset table becomes a quoted identifier, so panels can write
 * `FROM $vehicles`.
 */
export function interpolateSql(sql: string, options: InterpolateOptions): string {
  const withVariables = options.templateSrv.replace(sql, options.scopedVars, (value: unknown) =>
    typeof value === 'string' && options.isDatasetTable(value) ? quoteIdent(value) : sqlStringFormat(value)
  );
  return expandMacros(withVariables, {
    from: options.range.from.valueOf(),
    to: options.range.to.valueOf(),
    proxyBase: options.proxyBase,
    crossfilter: options.crossfilter,
  });
}
