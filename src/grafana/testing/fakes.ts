import { type DataQueryRequest, dateTime, type ScopedVars } from '@grafana/data';
import type { TemplateSrv } from '@grafana/runtime';
import type { DataQuery } from '@grafana/schema';

/**
 * Just enough of Grafana's template service for these tests. It handles `$x`,
 * `${x}` and `${x:raw}`, and calls the format function for every other
 * reference, as Grafana does. Scoped variables win over dashboard ones, as in
 * Grafana. Unknown names, `$__timeFilter` among them, are left alone, as
 * Grafana leaves them.
 */
export function fakeTemplateSrv(variables: Record<string, string | string[]>): TemplateSrv {
  const replace = (target = '', scopedVars?: ScopedVars, format?: unknown): string =>
    target.replace(
      /\$\{(\w+)(?::(\w+))?\}|\$(\w+)/g,
      (match: string, braced: string | undefined, fmt: string | undefined, bare: string | undefined) => {
        const name = (braced ?? bare) as string;
        const scoped = scopedVars?.[name];
        if (!scoped && !(name in variables)) {
          return match;
        }
        const value: unknown = scoped ? scoped.value : variables[name];
        if (fmt === 'raw') {
          return Array.isArray(value) ? value.join(',') : String(value);
        }
        return typeof format === 'function' ? (format as (v: unknown) => string)(value) : String(value);
      }
    );
  return {
    replace,
    getVariables: () => [],
    containsTemplate: () => false,
    updateTimeRange: () => undefined,
  } as unknown as TemplateSrv;
}

export function makeRequest<Q extends DataQuery>(
  targets: Q[],
  extra: Partial<DataQueryRequest<Q>> = {}
): DataQueryRequest<Q> {
  const from = dateTime(Date.UTC(2026, 8, 18));
  const to = dateTime(Date.UTC(2026, 8, 19));
  return {
    requestId: 'test',
    interval: '1m',
    intervalMs: 60_000,
    range: { from, to, raw: { from: 'now-1d', to: 'now' } },
    scopedVars: {},
    targets,
    timezone: 'utc',
    app: 'dashboard',
    startTime: 0,
    ...extra,
  } as DataQueryRequest<Q>;
}
