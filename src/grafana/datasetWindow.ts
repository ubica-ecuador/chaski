import { dateTime, type ScopedVars, type TimeRange } from '@grafana/data';

import type { LoadWindow, RawTime } from '../engine/rangeReuse';

const rawTime = (raw: unknown): RawTime => (typeof raw === 'string' ? raw : Number((raw as { valueOf(): number }).valueOf()));

/** A request's time range as the engine's reuse rule reads it. */
export function windowOf(range: TimeRange): LoadWindow {
  return {
    from: range.from.valueOf(),
    to: range.to.valueOf(),
    rawFrom: rawTime(range.raw.from),
    rawTo: rawTime(range.raw.to),
  };
}

/** A loaded window back as a TimeRange, to interpolate a source as it read at load time. */
export function rangeOf(window: LoadWindow): TimeRange {
  const from = dateTime(window.from);
  const to = dateTime(window.to);
  return { from, to, raw: { from, to } };
}

/** `__from`/`__to` pinned to a window, for Grafana's template service. */
export function scopedTimeOf(window: LoadWindow): ScopedVars {
  return {
    __from: { text: String(window.from), value: window.from },
    __to: { text: String(window.to), value: window.to },
  };
}
