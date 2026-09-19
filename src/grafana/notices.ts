import type { QueryResultMetaNotice } from '@grafana/data';

import type { DatasetState } from '../engine/types';

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.round(minutes / 60)} h`;
}

/**
 * A warning on every frame that read a dataset whose last reload failed. Stale
 * data must say so: a dashboard that measures freshness is the worst place to
 * serve an old copy without a word.
 */
export function staleNotices(states: DatasetState[], executedSql: string, now: number): QueryResultMetaNotice[] {
  return states
    .filter((state) => state.stale && executedSql.includes(state.table))
    .map((state) => ({
      severity: 'warning' as const,
      text: `${state.name}: data from ${formatAge(now - state.loadedAt)} ago — the reload failed (${state.stale!.error})`,
    }));
}
