import type { FilterDeclaration, RangeFilter } from '../engine/crossfilter';
import { type ControlLook, rangeSpec } from './specs';

/*
 * The timeline: one range filter over times drawn the width of the panel, with
 * a play button that moves its brush a bin at a time. Each step is a brush
 * like one drawn by hand: the other controls and any Mosaic panel on the
 * Selection follow it live, and its variables are written once it rests, so a
 * map reading them as its time window follows too. Play waits for the panels
 * the write set off before it steps again.
 */

/** `slide` moves a window of fixed width; `grow` keeps the start and moves the end. */
export type PlayMode = 'slide' | 'grow';

export type Window = [number, number];

/** The filter a timeline draws: the range filter named, or the first one over times. */
export function timelineFilter(filters: FilterDeclaration[], name: string): RangeFilter | undefined {
  const ranges = filters.filter((f): f is RangeFilter => f.type === 'range');
  const wanted = name.trim();
  return wanted ? ranges.find((f) => f.name === wanted) : ranges.find((f) => f.as === 'time');
}

const AXIS_LABEL_WIDTH = 110;
const MIN_HEIGHT = 48;

/** The filter's histogram at the panel's width and height, with as many ticks as their labels allow. */
export function timelineSpec(
  dataset: string,
  filter: RangeFilter,
  selection: string,
  bins: number,
  look: ControlLook,
  height: number
) {
  const spec = rangeSpec(dataset, filter, selection, bins, look);
  return {
    ...spec,
    height: Math.max(MIN_HEIGHT, Math.floor(height)),
    xTicks: Math.max(3, Math.floor(spec.width / AXIS_LABEL_WIDTH)),
  };
}

/** A fraction of a step: ends this close are equal, so a window that reached an end is at it. */
const EPSILON = 1e-6;

const width = ([lo, hi]: Window) => hi - lo;

/** A window as wide as a tenth of the axis, in whole steps, at least one. */
const firstWidth = (domain: Window, step: number) => Math.max(1, Math.round(width(domain) / 10 / step)) * step;

/**
 * Where play starts: the window held, unless it already reached the end;
 * then, or with none held, the axis's start. A slide keeps the held width or
 * takes a tenth of the axis; a grow starts one step wide. A window held wider
 * than half the axis is no window to slide: a kepler map publishing its whole
 * time window leaves one, a little narrower or wider than the axis's bins. A
 * slide then starts over a tenth wide.
 */
export function startWindow(domain: Window, step: number, mode: PlayMode, held?: Window): Window {
  const [d0, d1] = domain;
  const kept = held && (mode === 'grow' || width(held) <= width(domain) / 2) ? held : undefined;
  if (kept && kept[1] < d1 - step * EPSILON) {
    return kept;
  }
  if (mode === 'grow') {
    return [d0, Math.min(d1, d0 + step)];
  }
  return [d0, Math.min(d1, d0 + (kept ? width(kept) : firstWidth(domain, step)))];
}

/** The window a step later, the last one clamped to the axis's end; undefined once it is there. */
export function nextWindow(domain: Window, window: Window, step: number, mode: PlayMode): Window | undefined {
  const [lo, hi] = window;
  const end = domain[1];
  if (hi >= end - step * EPSILON) {
    return undefined;
  }
  if (mode === 'grow') {
    return [lo, Math.min(end, hi + step)];
  }
  const shift = Math.min(step, end - hi);
  return [lo + shift, hi + shift];
}

/** The window a step earlier, the first one clamped to the axis's start; undefined once it is there. */
export function previousWindow(domain: Window, window: Window, step: number, mode: PlayMode): Window | undefined {
  const [lo, hi] = window;
  if (mode === 'grow') {
    return hi - step > lo + step * EPSILON ? [lo, hi - step] : undefined;
  }
  const start = domain[0];
  if (lo <= start + step * EPSILON) {
    return undefined;
  }
  const shift = Math.min(step, lo - start);
  return [lo - shift, hi - shift];
}

/** What a histogram mark drew last: its bins' ends. */
interface DrawnBins {
  channels: Array<{ channel: string; as?: string }>;
  data?: { columns?: Record<string, ArrayLike<unknown>> };
}

const asNumber = (value: unknown) => (value instanceof Date ? value.getTime() : Number(value));

/**
 * One bin of the histogram, the step play moves by: read from the bins the
 * mark drew, which Mosaic rounds to a nice size (a day, an hour), or the axis
 * over the bins asked for while it has drawn none.
 */
export function stepOf(mark: unknown, domain: Window, bins: number): number {
  const drawn = mark as DrawnBins | undefined;
  const columns = drawn?.data?.columns;
  const column = (name: string) => columns?.[drawn?.channels.find((c) => c.channel === name)?.as ?? name];
  const x1 = column('x1');
  const x2 = column('x2');
  if (x1 && x2 && x1.length > 0) {
    const size = Math.abs(asNumber(x2[0]) - asNumber(x1[0]));
    if (Number.isFinite(size) && size > 0) {
      return size;
    }
  }
  return width(domain) / Math.max(1, bins);
}

/** The engine's two activity transitions, as Chaski announces them on Grafana's event bus. */
export type ActivityState = 'busy' | 'settled';

/**
 * Resolves once a step has had its time: at least `ms`, and until the
 * queries it set off have settled, at most `ms + cap`. A step's variables are
 * written a moment after it, so work that starts within `ms` counts.
 */
export function paced(
  ms: number,
  cap: number,
  listen: (listener: (state: ActivityState) => void) => () => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let busy = false;
    let waited = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const done = () => {
      timers.forEach(clearTimeout);
      stop();
      signal.removeEventListener('abort', done);
      resolve();
    };
    const stop = listen((state) => {
      busy = state === 'busy';
      if (!busy && waited) {
        done();
      }
    });
    timers.push(
      setTimeout(() => {
        waited = true;
        if (!busy) {
          done();
        }
      }, ms),
      setTimeout(done, ms + cap)
    );
    signal.addEventListener('abort', done);
  });
}

/** What play needs of the timeline's brush. */
export interface Player {
  /** The axis's ends. */
  domain(): Window;
  /** One bin. */
  step(): number;
  /** The window the brush holds, here or on a brush linked to it. */
  held(): Window | undefined;
  /** Moves the brush, as a drag would. */
  set(window: Window): void;
  /** Resolves once the controls drew what the last move left. */
  settled(): Promise<void>;
}

/** The longest a step waits for the panels it set off, past its own time. */
const STEP_CAP_MS = 5000;

/**
 * Plays the brush to the axis's end, a step each `ms` or once the controls
 * and panels caught up, whichever is later. Resolves at the end or once
 * aborted; the brush stays where it got to.
 */
export async function play(
  player: Player,
  mode: PlayMode,
  ms: number,
  listen: (listener: (state: ActivityState) => void) => () => void,
  signal: AbortSignal
): Promise<void> {
  let window = startWindow(player.domain(), player.step(), mode, player.held());
  player.set(window);
  while (!signal.aborted) {
    await Promise.all([paced(ms, STEP_CAP_MS, listen, signal), player.settled().catch(() => {})]);
    if (signal.aborted) {
      return;
    }
    // From the brush as it is: a linked brush may have moved it.
    const next = nextWindow(player.domain(), player.held() ?? window, player.step(), mode);
    if (!next) {
      return;
    }
    window = next;
    player.set(window);
  }
}

/** A time as the filter's chip shows it: the date, and the minute unless it is midnight. */
const timeText = (ms: number) => {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
};

/** The window the brush holds, for the bar: times to the minute, within one day as a date and two times. */
export function formatWindow([lo, hi]: Window, asTime: boolean): string {
  if (!asTime) {
    const short = (v: number) => String(Number(v.toPrecision(4)));
    return `${short(lo)} – ${short(hi)}`;
  }
  const [a, b] = [new Date(lo).toISOString(), new Date(hi).toISOString()];
  if (a.slice(0, 10) === b.slice(0, 10)) {
    return `${a.slice(0, 10)} ${a.slice(11, 16)}–${b.slice(11, 16)}`;
  }
  return `${timeText(lo)} – ${timeText(hi)}`;
}
