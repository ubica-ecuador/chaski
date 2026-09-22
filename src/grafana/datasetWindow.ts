import { dateTime, type ScopedVars, type TimeRange } from '@grafana/data';

import type { LoadWindow, RawTime } from '../engine/rangeReuse';

/** A raw bound as the reuse rule compares it: relative text as is, anything else as epoch ms. */
function rawTime(raw: unknown, evaluated: number): RawTime {
  if (typeof raw === 'string') {
    return raw;
  }
  return raw === undefined || raw === null ? evaluated : Number((raw as { valueOf(): number }).valueOf());
}

/** A request's time range as the engine's reuse rule reads it. A missing raw bound counts as absolute. */
export function windowOf(range: TimeRange): LoadWindow {
  const from = range.from.valueOf();
  const to = range.to.valueOf();
  return { from, to, rawFrom: rawTime(range.raw?.from, from), rawTo: rawTime(range.raw?.to, to) };
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
