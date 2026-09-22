import type { ScopedVars, TimeRange } from '@grafana/data';
import type { TemplateSrv } from '@grafana/runtime';

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
  });
}
