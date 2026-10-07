import { isAssistantAvailable } from '@grafana/assistant';
import { dateMath, dateTime } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { tableFromIPC } from 'apache-arrow';

import type { DigestColumn } from '../assistant/digest';
import { startAssistantContext } from '../assistant/liveContext';
import { quoteIdent } from '../engine/sql';
import type { ChaskiEngineApi } from './publicApi';

/** One end of the URL's range as an ISO instant: epoch milliseconds, or date math like `now-6h`. */
const instant = (value: unknown, roundUp: boolean): string | undefined => {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  // dateMath.parse, not its successor toDateTime: @grafana/data comes from the
  // host Grafana at runtime, and parse is there on every version we support.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const parsed = /^\d+$/.test(value) ? dateTime(Number(value)) : dateMath.parse(value, roundUp);
  return parsed?.isValid() ? parsed.toISOString() : undefined;
};

/** The dashboard's range from the URL; undefined when either end is missing or unreadable. */
export function urlTimeRange(search: { from?: unknown; to?: unknown }): { from: string; to: string } | undefined {
  const from = instant(search.from, false);
  const to = instant(search.to, true);
  return from && to ? { from, to } : undefined;
}

/** The rows of a `DESCRIBE`, as column names and DuckDB types. */
export function columnsOf(ipc: Uint8Array): DigestColumn[] {
  return tableFromIPC(ipc)
    .toArray()
    .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
}

/**
 * The columns of one loaded version of a dataset. Dataset tables live in
 * `main`, which an explorer connection reads qualified; the query runs there,
 * so it never counts toward the activity event.
 */
export async function describeTable(api: ChaskiEngineApi, table: string): Promise<DigestColumn[]> {
  return columnsOf(await api.queryIPC(`DESCRIBE main.${quoteIdent(table)}`));
}

/**
 * Tells the Grafana Assistant about the datasets on screen, through the same
 * API other plugins use. DESCRIBE runs on explorer connections, so it never
 * counts toward the activity event.
 */
export function startAssistantForEngine(
  api: ChaskiEngineApi,
  registry: { activeDashboard(): string | undefined }
): () => void {
  return startAssistantContext({
    datasets: () => api.datasets(),
    onChange: (listener) => api.onChange(listener),
    describe: (table) => describeTable(api, table),
    activeDashboard: () => registry.activeDashboard(),
    timeRange: () => urlTimeRange(locationService.getSearchObject()),
    onLocation: (listener) => locationService.getHistory().listen(() => listener()),
    available: isAssistantAvailable(),
  });
}
